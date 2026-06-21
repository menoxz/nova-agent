/**
 * Nova Agent — Tool: goal
 *
 * Structured local objective contract management.
 *
 * Actions:
 * - get
 * - set
 * - update
 * - complete
 * - clear
 *
 * Storage defaults to <cwd>/.nova/goal.json and is written atomically.
 */

import { z } from 'zod';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { NovaTool } from '../../types.js';

const STORE_VERSION = 1;
const MAX_OBJECTIVE_CHARS = 2_000;
const MAX_ITEM_CHARS = 500;
const MAX_ITEMS = 50;
const MAX_SUMMARY_CHARS = 2_000;
const MAX_HISTORY = 100;
const MAX_STORE_BYTES = 1_000_000;

const statuses = ['active', 'blocked', 'completed', 'cancelled'] as const;
type GoalStatus = typeof statuses[number];

type GoalContract = {
  id: string;
  objective: string;
  dod: string[];
  outOfScope: string[];
  status: GoalStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  completionSummary?: string;
};

type AuditEvent = {
  at: string;
  action: 'set' | 'update' | 'complete' | 'clear';
  goalId?: string;
  status?: GoalStatus;
  summary: string;
  changes?: string[];
};

type GoalStore = {
  version: number;
  createdAt: string;
  updatedAt: string;
  nextSeq: number;
  current: GoalContract | null;
  history: AuditEvent[];
};

function nowIso(): string {
  return new Date().toISOString();
}

function isStatus(value: unknown): value is GoalStatus {
  return typeof value === 'string' && (statuses as readonly string[]).includes(value);
}

function validateObjective(input: unknown): string {
  if (typeof input !== 'string') throw new Error('objective must be a string.');
  const objective = input.replace(/\s+/g, ' ').trim();
  if (!objective) throw new Error('objective is required.');
  if (objective.length > MAX_OBJECTIVE_CHARS) throw new Error(`objective is too long (max ${MAX_OBJECTIVE_CHARS} chars).`);
  return objective;
}

function validateItems(input: unknown, field: 'dod' | 'outOfScope'): string[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new Error(`${field} must be an array of strings.`);
  if (input.length > MAX_ITEMS) throw new Error(`${field} has too many items (max ${MAX_ITEMS}).`);
  const result: string[] = [];
  for (const [idx, raw] of input.entries()) {
    if (typeof raw !== 'string') throw new Error(`${field}[${idx}] must be a string.`);
    const item = raw.replace(/\s+/g, ' ').trim();
    if (!item) continue;
    if (item.length > MAX_ITEM_CHARS) throw new Error(`${field}[${idx}] is too long (max ${MAX_ITEM_CHARS} chars).`);
    result.push(item);
  }
  return Array.from(new Set(result));
}

function validateSummary(input: unknown): string | undefined {
  if (input === undefined || input === null) return undefined;
  if (typeof input !== 'string') throw new Error('summary must be a string.');
  const summary = input.trim();
  if (summary.length > MAX_SUMMARY_CHARS) throw new Error(`summary is too long (max ${MAX_SUMMARY_CHARS} chars).`);
  return summary || undefined;
}

function validateId(input: unknown): string {
  if (typeof input !== 'string' || !input.trim()) throw new Error('goal id must be a non-empty string.');
  const id = input.trim();
  if (!/^goal_[a-z0-9]+_[a-z0-9]{4,}$/.test(id)) throw new Error(`invalid goal id: ${id}`);
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
  return join(cwd, '.nova', 'goal.json');
}

function emptyStore(): GoalStore {
  const now = nowIso();
  return { version: STORE_VERSION, createdAt: now, updatedAt: now, nextSeq: 1, current: null, history: [] };
}

function validateGoal(value: any): GoalContract {
  if (!value || typeof value !== 'object') throw new Error('goal is not an object.');
  const id = validateId(value.id);
  if (!isStatus(value.status)) throw new Error(`goal ${id} has invalid status: ${value.status}`);
  return {
    id,
    objective: validateObjective(value.objective),
    dod: validateItems(value.dod, 'dod'),
    outOfScope: validateItems(value.outOfScope, 'outOfScope'),
    status: value.status,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : nowIso(),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : nowIso(),
    completedAt: typeof value.completedAt === 'string' ? value.completedAt : undefined,
    completionSummary: validateSummary(value.completionSummary),
  };
}

function validateHistory(input: any): AuditEvent[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new Error('history must be an array.');
  return input.slice(-MAX_HISTORY).map((event, idx) => {
    if (!event || typeof event !== 'object') throw new Error(`history[${idx}] is invalid.`);
    const action = event.action;
    if (!['set', 'update', 'complete', 'clear'].includes(action)) throw new Error(`history[${idx}] has invalid action: ${action}`);
    const status = event.status === undefined ? undefined : event.status;
    if (status !== undefined && !isStatus(status)) throw new Error(`history[${idx}] has invalid status: ${status}`);
    const changes = Array.isArray(event.changes)
      ? event.changes.map((c: unknown) => String(c).slice(0, 200)).slice(0, 20)
      : undefined;
    return {
      at: typeof event.at === 'string' ? event.at : nowIso(),
      action,
      goalId: typeof event.goalId === 'string' ? event.goalId : undefined,
      status,
      summary: validateSummary(event.summary) || action,
      changes,
    };
  });
}

function validateStoreShape(value: any): GoalStore {
  if (!value || typeof value !== 'object') throw new Error('goal store is not a JSON object.');
  if (value.version !== STORE_VERSION) throw new Error(`unsupported goal store version: ${value.version}`);
  const current = value.current === null || value.current === undefined ? null : validateGoal(value.current);
  return {
    version: STORE_VERSION,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : nowIso(),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : nowIso(),
    nextSeq: Math.max(1, Number.isInteger(value.nextSeq) ? value.nextSeq : 1),
    current,
    history: validateHistory(value.history),
  };
}

async function readStore(path: string): Promise<GoalStore> {
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new Error(`goal store path is not a file: ${path}`);
    if (info.size > MAX_STORE_BYTES) throw new Error(`goal store is too large (${info.size} bytes, max ${MAX_STORE_BYTES}).`);
    const text = await readFile(path, 'utf8');
    return validateStoreShape(JSON.parse(text));
  } catch (err: any) {
    if (err?.code === 'ENOENT') return emptyStore();
    if (err instanceof SyntaxError) throw new Error(`goal store is corrupted JSON: ${path}`);
    throw err;
  }
}

async function writeStore(path: string, store: GoalStore): Promise<void> {
  store.updatedAt = nowIso();
  store.history = store.history.slice(-MAX_HISTORY);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  const payload = JSON.stringify(store, null, 2) + '\n';
  if (Buffer.byteLength(payload, 'utf8') > MAX_STORE_BYTES) throw new Error(`goal store would exceed ${MAX_STORE_BYTES} bytes.`);
  await writeFile(tmp, payload, 'utf8');
  await rename(tmp, path);
}

function nextId(store: GoalStore): string {
  const seq = store.nextSeq++;
  return `goal_${Date.now().toString(36)}_${seq.toString(36).padStart(4, '0')}`;
}

function audit(store: GoalStore, event: AuditEvent): void {
  store.history.push(event);
  store.history = store.history.slice(-MAX_HISTORY);
}

function formatGoal(goal: GoalContract | null): string[] {
  if (!goal) return ['(no current goal)'];
  const lines = [
    `ID: ${goal.id}`,
    `Status: ${goal.status}`,
    `Objective: ${goal.objective}`,
    `Created: ${goal.createdAt}`,
    `Updated: ${goal.updatedAt}`,
  ];
  if (goal.completedAt) lines.push(`Completed: ${goal.completedAt}`);
  if (goal.completionSummary) lines.push(`Completion summary: ${goal.completionSummary}`);
  lines.push('', 'Definition of Done:');
  if (goal.dod.length === 0) lines.push('- (none)');
  else lines.push(...goal.dod.map(item => `- ${item}`));
  lines.push('', 'Out of scope:');
  if (goal.outOfScope.length === 0) lines.push('- (none)');
  else lines.push(...goal.outOfScope.map(item => `- ${item}`));
  return lines;
}

function formatHistory(history: AuditEvent[], limit: number): string[] {
  const events = history.slice(-limit).reverse();
  if (events.length === 0) return ['(no history)'];
  return events.map(event => {
    const changes = event.changes?.length ? ` | changes: ${event.changes.join(', ')}` : '';
    return `- ${event.at} ${event.action}${event.goalId ? ` ${event.goalId}` : ''}${event.status ? ` [${event.status}]` : ''}: ${event.summary}${changes}`;
  });
}

function formatResult(path: string, store: GoalStore, heading: string, historyLimit: number, extra?: string): string {
  const lines = [`## Goal ${heading}`, `Store: ${path}`, ''];
  if (extra) lines.push(extra, '');
  lines.push('### Current goal', ...formatGoal(store.current), '', `### History (last ${historyLimit})`, ...formatHistory(store.history, historyLimit));
  return lines.join('\n').trimEnd();
}

function changedFields(before: GoalContract, after: GoalContract): string[] {
  const changes: string[] = [];
  if (before.objective !== after.objective) changes.push('objective');
  if (before.status !== after.status) changes.push('status');
  if (JSON.stringify(before.dod) !== JSON.stringify(after.dod)) changes.push('dod');
  if (JSON.stringify(before.outOfScope) !== JSON.stringify(after.outOfScope)) changes.push('outOfScope');
  if (before.completionSummary !== after.completionSummary) changes.push('completionSummary');
  return changes;
}

export const goalTool: NovaTool = {
  name: 'goal',
  description: 'Manage a local structured objective contract with get/set/update/complete/clear, objective + Definition of Done + out-of-scope, validated statuses, local atomic persistence, minimal audit history, clear errors, and size limits.',
  capability: 'memory',
  readOnly: false,
  riskLevel: 'medium',
  inputSchema: z.object({
    action: z.enum(['get', 'set', 'update', 'complete', 'clear']).describe('Goal operation.'),
    cwd: z.string().optional().describe('Project directory for local .nova/goal.json storage. Default: current process cwd.'),
    objective: z.string().optional().describe(`Goal objective for set/update (max ${MAX_OBJECTIVE_CHARS} chars).`),
    dod: z.array(z.string()).optional().describe(`Definition of Done items for set/update; replaces existing DoD (max ${MAX_ITEMS} items).`),
    outOfScope: z.array(z.string()).optional().describe(`Out-of-scope items for set/update; replaces existing list (max ${MAX_ITEMS} items).`),
    appendDod: z.array(z.string()).optional().describe('Definition of Done items to append on update.'),
    appendOutOfScope: z.array(z.string()).optional().describe('Out-of-scope items to append on update.'),
    status: z.enum(statuses).optional().describe('Goal status for set/update. Default for set: active.'),
    summary: z.string().optional().describe(`Audit/completion summary (max ${MAX_SUMMARY_CHARS} chars).`),
    confirm: z.boolean().optional().describe('Required true for clear, and for set when replacing an active/blocked current goal.'),
    historyLimit: z.number().int().min(0).max(MAX_HISTORY).optional().describe('Number of audit events to show. Default: 10.'),
    format: z.enum(['text', 'json']).optional().describe('Output format. Default: text.'),
  }),
  execute: async (input) => {
    try {
      const cwd = await validateCwd(input.cwd);
      const path = storePath(cwd);
      const store = await readStore(path);
      const action = input.action as string;
      const historyLimit = clampNumber(input.historyLimit, 10, 0, MAX_HISTORY);
      let changed = false;
      let extra = '';

      if (action === 'get') {
        // read-only
      } else if (action === 'set') {
        if (store.current && ['active', 'blocked'].includes(store.current.status) && input.confirm !== true) {
          throw new Error(`set would replace current ${store.current.status} goal ${store.current.id}; pass confirm=true to replace it.`);
        }
        const now = nowIso();
        const status = input.status === undefined ? 'active' : input.status;
        if (!isStatus(status)) throw new Error(`invalid status: ${status}. Allowed: ${statuses.join(', ')}`);
        const goal: GoalContract = {
          id: nextId(store),
          objective: validateObjective(input.objective),
          dod: validateItems(input.dod, 'dod'),
          outOfScope: validateItems(input.outOfScope, 'outOfScope'),
          status,
          createdAt: now,
          updatedAt: now,
          completedAt: status === 'completed' ? now : undefined,
          completionSummary: status === 'completed' ? validateSummary(input.summary) : undefined,
        };
        store.current = goal;
        audit(store, { at: now, action: 'set', goalId: goal.id, status: goal.status, summary: validateSummary(input.summary) || 'Goal set', changes: ['objective', 'dod', 'outOfScope', 'status'] });
        extra = `Set: ${goal.id}`;
        changed = true;
      } else if (action === 'update') {
        if (!store.current) throw new Error('no current goal to update.');
        const before = { ...store.current, dod: [...store.current.dod], outOfScope: [...store.current.outOfScope] };
        if (input.objective !== undefined) store.current.objective = validateObjective(input.objective);
        if (input.dod !== undefined) store.current.dod = validateItems(input.dod, 'dod');
        if (input.outOfScope !== undefined) store.current.outOfScope = validateItems(input.outOfScope, 'outOfScope');
        if (input.appendDod !== undefined) store.current.dod = Array.from(new Set([...store.current.dod, ...validateItems(input.appendDod, 'dod')]));
        if (input.appendOutOfScope !== undefined) store.current.outOfScope = Array.from(new Set([...store.current.outOfScope, ...validateItems(input.appendOutOfScope, 'outOfScope')]));
        if (store.current.dod.length > MAX_ITEMS) throw new Error(`dod has too many items after append (max ${MAX_ITEMS}).`);
        if (store.current.outOfScope.length > MAX_ITEMS) throw new Error(`outOfScope has too many items after append (max ${MAX_ITEMS}).`);
        if (input.status !== undefined) {
          if (!isStatus(input.status)) throw new Error(`invalid status: ${input.status}. Allowed: ${statuses.join(', ')}`);
          store.current.status = input.status;
          store.current.completedAt = input.status === 'completed' ? (store.current.completedAt || nowIso()) : undefined;
        }
        if (input.summary !== undefined && store.current.status === 'completed') store.current.completionSummary = validateSummary(input.summary);
        store.current.updatedAt = nowIso();
        const changes = changedFields(before, store.current);
        if (changes.length === 0) throw new Error('update requires at least one changed field.');
        audit(store, { at: nowIso(), action: 'update', goalId: store.current.id, status: store.current.status, summary: validateSummary(input.summary) || 'Goal updated', changes });
        extra = `Updated: ${store.current.id}`;
        changed = true;
      } else if (action === 'complete') {
        if (!store.current) throw new Error('no current goal to complete.');
        store.current.status = 'completed';
        store.current.completedAt = store.current.completedAt || nowIso();
        store.current.updatedAt = nowIso();
        store.current.completionSummary = validateSummary(input.summary) || store.current.completionSummary;
        audit(store, { at: nowIso(), action: 'complete', goalId: store.current.id, status: 'completed', summary: store.current.completionSummary || 'Goal completed', changes: ['status', 'completedAt', 'completionSummary'] });
        extra = `Completed: ${store.current.id}`;
        changed = true;
      } else if (action === 'clear') {
        if (input.confirm !== true) throw new Error('clear requires confirm=true.');
        const previous = store.current;
        store.current = null;
        audit(store, { at: nowIso(), action: 'clear', goalId: previous?.id, status: previous?.status, summary: validateSummary(input.summary) || (previous ? `Cleared goal ${previous.id}` : 'Cleared empty goal state'), changes: ['current'] });
        extra = previous ? `Cleared: ${previous.id}` : 'Cleared: no current goal existed';
        changed = true;
      } else {
        throw new Error(`unsupported goal action: ${action}`);
      }

      if (changed) await writeStore(path, store);
      if (input.format === 'json') {
        return JSON.stringify({ action, store: path, current: store.current, history: store.history.slice(-historyLimit), extra }, null, 2);
      }
      return formatResult(path, store, action, historyLimit, extra);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error in goal tool: ${msg}\nAllowed statuses: ${statuses.join(', ')}. Actions: get, set, update, complete, clear.`;
    }
  },
};
