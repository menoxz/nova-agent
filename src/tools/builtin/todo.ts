/**
 * Nova Agent — Tool: todo
 *
 * Structured local task persistence for Nova.
 *
 * Actions:
 * - list
 * - add
 * - update
 * - complete
 * - remove
 * - clear
 *
 * Storage defaults to <cwd>/.nova/todos.json and is written atomically.
 */

import { z } from 'zod';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { NovaTool } from '../../types.js';

const STORE_VERSION = 1;
const MAX_TASKS = 500;
const MAX_TITLE_CHARS = 240;
const MAX_NOTES_CHARS = 2_000;
const MAX_TAGS = 20;
const MAX_TAG_CHARS = 40;
const MAX_STORE_BYTES = 1_000_000;
const DEFAULT_LIST_LIMIT = 100;

const statuses = ['pending', 'in_progress', 'blocked', 'completed', 'cancelled'] as const;
const priorities = ['low', 'medium', 'high', 'critical'] as const;

type TodoStatus = typeof statuses[number];
type TodoPriority = typeof priorities[number];

type TodoTask = {
  id: string;
  title: string;
  status: TodoStatus;
  priority: TodoPriority;
  notes?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

type TodoStore = {
  version: number;
  createdAt: string;
  updatedAt: string;
  nextSeq: number;
  tasks: TodoTask[];
};

type Filters = {
  status?: TodoStatus;
  priority?: TodoPriority;
  tag?: string;
  search?: string;
  includeCompleted: boolean;
  limit: number;
};

function nowIso(): string {
  return new Date().toISOString();
}

function isStatus(value: unknown): value is TodoStatus {
  return typeof value === 'string' && (statuses as readonly string[]).includes(value);
}

function isPriority(value: unknown): value is TodoPriority {
  return typeof value === 'string' && (priorities as readonly string[]).includes(value);
}

function validateTitle(input: unknown): string {
  if (typeof input !== 'string') throw new Error('title must be a string.');
  const title = input.replace(/\s+/g, ' ').trim();
  if (!title) throw new Error('title is required.');
  if (title.length > MAX_TITLE_CHARS) throw new Error(`title is too long (max ${MAX_TITLE_CHARS} chars).`);
  return title;
}

function validateOptionalNotes(input: unknown): string | undefined {
  if (input === undefined || input === null) return undefined;
  if (typeof input !== 'string') throw new Error('notes must be a string.');
  const notes = input.trim();
  if (notes.length > MAX_NOTES_CHARS) throw new Error(`notes are too long (max ${MAX_NOTES_CHARS} chars).`);
  return notes || undefined;
}

function validateTags(input: unknown): string[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new Error('tags must be an array of strings.');
  if (input.length > MAX_TAGS) throw new Error(`too many tags (max ${MAX_TAGS}).`);
  const tags = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== 'string') throw new Error('each tag must be a string.');
    const tag = raw.trim().toLowerCase();
    if (!tag) continue;
    if (tag.length > MAX_TAG_CHARS) throw new Error(`tag is too long (max ${MAX_TAG_CHARS} chars): ${tag}`);
    if (!/^[a-z0-9][a-z0-9_.-]*$/.test(tag)) throw new Error(`invalid tag: ${tag}. Use lowercase letters/numbers plus _, ., -.`);
    tags.add(tag);
  }
  return Array.from(tags).sort();
}

function validateId(input: unknown): string {
  if (typeof input !== 'string' || !input.trim()) throw new Error('id is required.');
  const id = input.trim();
  if (!/^todo_[a-z0-9]+_[a-z0-9]{4,}$/.test(id)) throw new Error(`invalid todo id: ${id}`);
  return id;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(min, Math.min(max, n));
}

async function validateCwd(input: unknown): Promise<string> {
  const cwd = resolve(typeof input === 'string' && input.trim() ? input : process.cwd());
  const info = await stat(cwd);
  if (!info.isDirectory()) throw new Error(`cwd is not a directory: ${cwd}`);
  return cwd;
}

function storePath(cwd: string): string {
  return join(cwd, '.nova', 'todos.json');
}

function emptyStore(): TodoStore {
  const now = nowIso();
  return { version: STORE_VERSION, createdAt: now, updatedAt: now, nextSeq: 1, tasks: [] };
}

function validateStoreShape(value: any): TodoStore {
  if (!value || typeof value !== 'object') throw new Error('todo store is not a JSON object.');
  if (value.version !== STORE_VERSION) throw new Error(`unsupported todo store version: ${value.version}`);
  if (!Array.isArray(value.tasks)) throw new Error('todo store tasks must be an array.');
  if (value.tasks.length > MAX_TASKS) throw new Error(`todo store has too many tasks (${value.tasks.length}, max ${MAX_TASKS}).`);
  const ids = new Set<string>();
  const tasks: TodoTask[] = value.tasks.map((task: any, idx: number) => {
    if (!task || typeof task !== 'object') throw new Error(`task ${idx} is invalid.`);
    const id = validateId(task.id);
    if (ids.has(id)) throw new Error(`duplicate task id in store: ${id}`);
    ids.add(id);
    const title = validateTitle(task.title);
    if (!isStatus(task.status)) throw new Error(`task ${id} has invalid status: ${task.status}`);
    if (!isPriority(task.priority)) throw new Error(`task ${id} has invalid priority: ${task.priority}`);
    return {
      id,
      title,
      status: task.status,
      priority: task.priority,
      notes: validateOptionalNotes(task.notes),
      tags: validateTags(task.tags),
      createdAt: typeof task.createdAt === 'string' ? task.createdAt : nowIso(),
      updatedAt: typeof task.updatedAt === 'string' ? task.updatedAt : nowIso(),
      completedAt: typeof task.completedAt === 'string' ? task.completedAt : undefined,
    };
  });
  return {
    version: STORE_VERSION,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : nowIso(),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : nowIso(),
    nextSeq: Math.max(1, Number.isInteger(value.nextSeq) ? value.nextSeq : tasks.length + 1),
    tasks,
  };
}

async function readStore(path: string): Promise<TodoStore> {
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new Error(`todo store path is not a file: ${path}`);
    if (info.size > MAX_STORE_BYTES) throw new Error(`todo store is too large (${info.size} bytes, max ${MAX_STORE_BYTES}).`);
    const text = await readFile(path, 'utf8');
    return validateStoreShape(JSON.parse(text));
  } catch (err: any) {
    if (err?.code === 'ENOENT') return emptyStore();
    if (err instanceof SyntaxError) throw new Error(`todo store is corrupted JSON: ${path}`);
    throw err;
  }
}

async function writeStore(path: string, store: TodoStore): Promise<void> {
  if (store.tasks.length > MAX_TASKS) throw new Error(`too many tasks (max ${MAX_TASKS}).`);
  store.updatedAt = nowIso();
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  const payload = JSON.stringify(store, null, 2) + '\n';
  if (Buffer.byteLength(payload, 'utf8') > MAX_STORE_BYTES) throw new Error(`todo store would exceed ${MAX_STORE_BYTES} bytes.`);
  await writeFile(tmp, payload, 'utf8');
  await rename(tmp, path);
}

function nextId(store: TodoStore): string {
  const seq = store.nextSeq++;
  return `todo_${Date.now().toString(36)}_${seq.toString(36).padStart(4, '0')}`;
}

function summary(store: TodoStore): string {
  const counts: Record<TodoStatus, number> = { pending: 0, in_progress: 0, blocked: 0, completed: 0, cancelled: 0 };
  for (const task of store.tasks) counts[task.status]++;
  return `Total: ${store.tasks.length} | pending: ${counts.pending} | in_progress: ${counts.in_progress} | blocked: ${counts.blocked} | completed: ${counts.completed} | cancelled: ${counts.cancelled}`;
}

function filtersFromInput(input: any): Filters {
  const status = input.status === undefined ? undefined : input.status;
  const priority = input.priority === undefined ? undefined : input.priority;
  if (status !== undefined && !isStatus(status)) throw new Error(`invalid status: ${status}. Allowed: ${statuses.join(', ')}`);
  if (priority !== undefined && !isPriority(priority)) throw new Error(`invalid priority: ${priority}. Allowed: ${priorities.join(', ')}`);
  const tag = input.tag === undefined ? undefined : validateTags([input.tag])[0];
  const search = typeof input.search === 'string' && input.search.trim() ? input.search.trim().toLowerCase() : undefined;
  return {
    status,
    priority,
    tag,
    search,
    includeCompleted: input.includeCompleted !== false,
    limit: clampNumber(input.limit, DEFAULT_LIST_LIMIT, 1, MAX_TASKS),
  };
}

function applyFilters(tasks: TodoTask[], filters: Filters): TodoTask[] {
  return tasks.filter(task => {
    if (filters.status && task.status !== filters.status) return false;
    if (filters.priority && task.priority !== filters.priority) return false;
    if (filters.tag && !task.tags.includes(filters.tag)) return false;
    if (!filters.includeCompleted && (task.status === 'completed' || task.status === 'cancelled')) return false;
    if (filters.search) {
      const haystack = `${task.title}\n${task.notes || ''}\n${task.tags.join(' ')}`.toLowerCase();
      if (!haystack.includes(filters.search)) return false;
    }
    return true;
  }).sort((a, b) => {
    const order: Record<TodoStatus, number> = { in_progress: 0, blocked: 1, pending: 2, completed: 3, cancelled: 4 };
    const statusDiff = order[a.status] - order[b.status];
    if (statusDiff !== 0) return statusDiff;
    const prio: Record<TodoPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    const prioDiff = prio[a.priority] - prio[b.priority];
    if (prioDiff !== 0) return prioDiff;
    return a.createdAt.localeCompare(b.createdAt);
  }).slice(0, filters.limit);
}

function formatTask(task: TodoTask): string {
  const tags = task.tags.length ? ` #${task.tags.join(' #')}` : '';
  const done = task.completedAt ? ` completedAt=${task.completedAt}` : '';
  const notes = task.notes ? `\n    notes: ${task.notes.replace(/\s+/g, ' ').slice(0, 300)}` : '';
  return `- ${task.id} [${task.status}/${task.priority}] ${task.title}${tags}${done}${notes}`;
}

function formatResult(storePathValue: string, store: TodoStore, heading: string, tasks?: TodoTask[], extra?: string): string {
  const lines = [`## Todo ${heading}`, `Store: ${storePathValue}`, summary(store), ''];
  if (extra) lines.push(extra, '');
  if (tasks) {
    if (tasks.length === 0) lines.push('(no tasks)');
    else lines.push(...tasks.map(formatTask));
  }
  return lines.join('\n').trimEnd();
}

function findTask(store: TodoStore, id: string): TodoTask {
  const task = store.tasks.find(t => t.id === id);
  if (!task) throw new Error(`todo not found: ${id}`);
  return task;
}

export const todoTool: NovaTool = {
  name: 'todo',
  description: 'Manage a local persistent structured todo list with stable IDs: list/add/update/complete/remove/clear. Validates status/priority/tags, supports filters and summaries, writes atomically to .nova/todos.json, and enforces task/store size limits.',
  capability: 'memory',
  readOnly: false,
  riskLevel: 'medium',
  inputSchema: z.object({
    action: z.enum(['list', 'add', 'update', 'complete', 'remove', 'clear']).describe('Todo operation.'),
    cwd: z.string().optional().describe('Project directory for local .nova/todos.json storage. Default: current process cwd.'),
    id: z.string().optional().describe('Task id for update/complete/remove.'),
    title: z.string().optional().describe(`Task title for add/update (max ${MAX_TITLE_CHARS} chars).`),
    status: z.enum(statuses).optional().describe('Task status or list/clear filter.'),
    priority: z.enum(priorities).optional().describe('Task priority or list/clear filter.'),
    notes: z.string().optional().describe(`Optional notes for add/update (max ${MAX_NOTES_CHARS} chars).`),
    tags: z.array(z.string()).optional().describe(`Tags for add/update. Lowercase letters/numbers plus _, ., -; max ${MAX_TAGS}.`),
    tag: z.string().optional().describe('Single tag filter for list/clear.'),
    search: z.string().optional().describe('Case-insensitive search filter for title/notes/tags.'),
    includeCompleted: z.boolean().optional().describe('For list: include completed/cancelled tasks. Default true.'),
    limit: z.number().int().min(1).max(MAX_TASKS).optional().describe(`For list: max tasks returned (default ${DEFAULT_LIST_LIMIT}).`),
    confirm: z.boolean().optional().describe('Required true for clear, because clear is destructive.'),
    format: z.enum(['text', 'json']).optional().describe('Output format. Default: text.'),
  }),
  execute: async (input) => {
    try {
      const cwd = await validateCwd(input.cwd);
      const path = storePath(cwd);
      const store = await readStore(path);
      const action = input.action as string;
      let changed = false;
      let outputTasks: TodoTask[] | undefined;
      let extra = '';

      if (action === 'list') {
        const filters = filtersFromInput(input);
        outputTasks = applyFilters(store.tasks, filters);
        extra = `Showing: ${outputTasks.length} task(s)`;
      } else if (action === 'add') {
        if (store.tasks.length >= MAX_TASKS) throw new Error(`cannot add task: max ${MAX_TASKS} tasks reached.`);
        const createdAt = nowIso();
        const taskStatus: TodoStatus = input.status === undefined ? 'pending' : (() => {
          if (!isStatus(input.status)) throw new Error(`invalid status: ${input.status}. Allowed: ${statuses.join(', ')}`);
          return input.status;
        })();
        const taskPriority: TodoPriority = input.priority === undefined ? 'medium' : (() => {
          if (!isPriority(input.priority)) throw new Error(`invalid priority: ${input.priority}. Allowed: ${priorities.join(', ')}`);
          return input.priority;
        })();
        const task: TodoTask = {
          id: nextId(store),
          title: validateTitle(input.title),
          status: taskStatus,
          priority: taskPriority,
          notes: validateOptionalNotes(input.notes),
          tags: validateTags(input.tags),
          createdAt,
          updatedAt: createdAt,
          completedAt: taskStatus === 'completed' ? createdAt : undefined,
        };
        store.tasks.push(task);
        outputTasks = [task];
        extra = `Added: ${task.id}`;
        changed = true;
      } else if (action === 'update') {
        const task = findTask(store, validateId(input.id));
        if (input.title !== undefined) task.title = validateTitle(input.title);
        if (input.status !== undefined) {
          if (!isStatus(input.status)) throw new Error(`invalid status: ${input.status}`);
          task.status = input.status;
          task.completedAt = input.status === 'completed' ? (task.completedAt || nowIso()) : undefined;
        }
        if (input.priority !== undefined) {
          if (!isPriority(input.priority)) throw new Error(`invalid priority: ${input.priority}`);
          task.priority = input.priority;
        }
        if (input.notes !== undefined) task.notes = validateOptionalNotes(input.notes);
        if (input.tags !== undefined) task.tags = validateTags(input.tags);
        task.updatedAt = nowIso();
        outputTasks = [task];
        extra = `Updated: ${task.id}`;
        changed = true;
      } else if (action === 'complete') {
        const task = findTask(store, validateId(input.id));
        task.status = 'completed';
        task.completedAt = task.completedAt || nowIso();
        task.updatedAt = nowIso();
        outputTasks = [task];
        extra = `Completed: ${task.id}`;
        changed = true;
      } else if (action === 'remove') {
        const id = validateId(input.id);
        const idx = store.tasks.findIndex(t => t.id === id);
        if (idx === -1) throw new Error(`todo not found: ${id}`);
        const [removed] = store.tasks.splice(idx, 1);
        outputTasks = [removed];
        extra = `Removed: ${removed.id}`;
        changed = true;
      } else if (action === 'clear') {
        if (input.confirm !== true) throw new Error('clear requires confirm=true.');
        const filters = filtersFromInput({ ...input, includeCompleted: true, limit: MAX_TASKS });
        const toRemove = new Set(applyFilters(store.tasks, filters).map(t => t.id));
        const removed = store.tasks.filter(t => toRemove.has(t.id));
        store.tasks = store.tasks.filter(t => !toRemove.has(t.id));
        outputTasks = removed;
        extra = `Cleared: ${removed.length} task(s)`;
        changed = true;
      } else {
        throw new Error(`unsupported todo action: ${action}`);
      }

      if (changed) await writeStore(path, store);

      if (input.format === 'json') {
        return JSON.stringify({ action, store: path, summary: summary(store), tasks: outputTasks ?? [], extra }, null, 2);
      }
      return formatResult(path, store, action, outputTasks, extra);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error in todo tool: ${msg}\nAllowed statuses: ${statuses.join(', ')}. Allowed priorities: ${priorities.join(', ')}. Actions: list, add, update, complete, remove, clear.`;
    }
  },
};
