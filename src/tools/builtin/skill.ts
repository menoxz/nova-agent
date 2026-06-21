/**
 * Nova Agent — Tool: skill
 *
 * Folder-based safe local registry for reusable skills.
 *
 * Layout:
 *   .nova/skills/_index.json
 *   .nova/skills/<slug>/SKILL.md
 *   .nova/skills/<slug>/metadata.json
 *   .nova/skills/<slug>/references|templates|models|scripts|examples|evals|tests/
 *   .nova/skills/<slug>/CHANGELOG.md
 *
 * This tool stores and returns text. It never executes skill content, scripts,
 * commands, or arbitrary paths outside the .nova/skills store.
 */

import { z } from 'zod';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { NovaTool } from '../../types.js';

const INDEX_VERSION = 2;
const MAX_SKILLS = 200;
const MAX_INDEX_BYTES = 2_000_000;
const MAX_METADATA_BYTES = 1_000_000;
const MAX_SKILL_MD_CHARS = 120_000;
const MAX_RESOURCE_CHARS = 100_000;
const MAX_RESOURCE_LOAD_CHARS = 150_000;
const MAX_RESOURCE_FILES_PER_CALL = 30;
const MAX_NAME_CHARS = 100;
const MAX_DESCRIPTION_CHARS = 1_500;
const MAX_LIST_ITEMS = 80;
const MAX_TAGS = 30;
const MAX_TOKEN_CHARS = 60;
const MAX_TRIGGER_CHARS = 240;
const MAX_AUDIT = 300;
const MAX_VERSIONS = 100;
const DEFAULT_LIMIT = 50;

const statuses = ['draft', 'active', 'archived'] as const;
const resourceCategories = ['references', 'templates', 'models', 'scripts', 'examples', 'evals', 'tests'] as const;

type SkillStatus = typeof statuses[number];
type ResourceCategory = typeof resourceCategories[number];

type ResourceFile = {
  category: ResourceCategory;
  path: string;
  size: number;
  hash: string;
  updatedAt: string;
};

type SkillVersion = {
  version: number;
  at: string;
  action: 'create' | 'update' | 'archive' | 'migrate';
  summary: string;
  contentHash: string;
  resourceCount: number;
  changes: string[];
};

type AuditEvent = {
  at: string;
  action: 'create' | 'update' | 'archive' | 'remove' | 'migrate';
  skillId?: string;
  slug?: string;
  version?: number;
  summary: string;
  changes?: string[];
};

type IndexSkill = {
  id: string;
  slug: string;
  name: string;
  description: string;
  tags: string[];
  aliases: string[];
  domains: string[];
  capabilities: string[];
  positiveTriggers: string[];
  negativeTriggers: string[];
  status: SkillStatus;
  version: number;
  skillDir: string;
  path: string;
  metadataPath: string;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
};

type SkillMetadata = IndexSkill & {
  resources: ResourceFile[];
  versions: SkillVersion[];
};

type SkillIndex = {
  version: number;
  createdAt: string;
  updatedAt: string;
  nextSeq: number;
  skills: IndexSkill[];
  audit: AuditEvent[];
};

type ResourceInput = { path: string; content: string };
type SearchHit = { skill: IndexSkill; score: number; matchedFields: string[]; snippet: string };

function nowIso(): string { return new Date().toISOString(); }
function byteLength(value: string): number { return Buffer.byteLength(value, 'utf8'); }
function hashText(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex'); }
function isStatus(value: unknown): value is SkillStatus { return typeof value === 'string' && (statuses as readonly string[]).includes(value); }
function isCategory(value: unknown): value is ResourceCategory { return typeof value === 'string' && (resourceCategories as readonly string[]).includes(value); }

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeOneLine(input: string): string { return input.replace(/\s+/g, ' ').trim(); }

function validateName(input: unknown): string {
  if (typeof input !== 'string') throw new Error('name must be a string.');
  const name = normalizeOneLine(input);
  if (!name) throw new Error('name is required.');
  if (name.length > MAX_NAME_CHARS) throw new Error(`name is too long (max ${MAX_NAME_CHARS} chars).`);
  return name;
}

function validateDescription(input: unknown): string {
  if (typeof input !== 'string') throw new Error('description must be a string.');
  const description = normalizeOneLine(input);
  if (!description) throw new Error('description is required.');
  if (description.length > MAX_DESCRIPTION_CHARS) throw new Error(`description is too long (max ${MAX_DESCRIPTION_CHARS} chars).`);
  return description;
}

function validateSkillBody(input: unknown): string {
  if (typeof input !== 'string') throw new Error('content must be a string.');
  const content = input.trim();
  if (!content) throw new Error('content is required.');
  if (content.includes('\0')) throw new Error('content must not contain NUL bytes.');
  if (content.length > MAX_SKILL_MD_CHARS) throw new Error(`content is too long (max ${MAX_SKILL_MD_CHARS} chars).`);
  return content;
}

function validateSummary(input: unknown, fallback: string): string {
  if (input === undefined || input === null || input === '') return fallback;
  if (typeof input !== 'string') throw new Error('summary must be a string.');
  const summary = normalizeOneLine(input);
  if (!summary) return fallback;
  if (summary.length > 1_000) throw new Error('summary is too long (max 1000 chars).');
  return summary;
}

function validateTokenList(input: unknown, field: string, max = MAX_LIST_ITEMS): string[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new Error(`${field} must be an array of strings.`);
  if (input.length > max) throw new Error(`${field} has too many items (max ${max}).`);
  const out = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== 'string') throw new Error(`${field} items must be strings.`);
    const item = raw.trim().toLowerCase();
    if (!item) continue;
    if (item.length > MAX_TOKEN_CHARS) throw new Error(`${field} item is too long (max ${MAX_TOKEN_CHARS} chars): ${item}`);
    if (!/^[a-z0-9][a-z0-9_.-]*$/.test(item)) throw new Error(`invalid ${field} item: ${item}. Use lowercase letters/numbers plus _, ., -.`);
    out.add(item);
  }
  return Array.from(out).sort();
}

function validateTriggers(input: unknown, field: string): string[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new Error(`${field} must be an array of strings.`);
  if (input.length > MAX_LIST_ITEMS) throw new Error(`${field} has too many items (max ${MAX_LIST_ITEMS}).`);
  const out = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== 'string') throw new Error(`${field} items must be strings.`);
    const item = normalizeOneLine(raw);
    if (!item) continue;
    if (item.length > MAX_TRIGGER_CHARS) throw new Error(`${field} item too long (max ${MAX_TRIGGER_CHARS} chars).`);
    out.add(item);
  }
  return Array.from(out);
}

function validateTags(input: unknown): string[] { return validateTokenList(input, 'tags', MAX_TAGS); }

function slugify(name: string): string {
  const slug = name.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 80);
  return slug || 'skill';
}

function validateSlug(value: string): string {
  const slug = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,100}$/.test(slug)) throw new Error(`invalid slug: ${value}`);
  return slug;
}

function validateIdOrSlug(input: unknown): string {
  if (typeof input !== 'string' || !input.trim()) throw new Error('idOrSlug is required.');
  const value = input.trim().toLowerCase();
  if (value.includes('\0') || value.includes('/') || value.includes('\\') || value.includes('..')) throw new Error('idOrSlug must be an id or slug, not a path.');
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(value)) throw new Error(`invalid idOrSlug: ${value}`);
  return value;
}

async function validateCwd(input: unknown): Promise<string> {
  const cwd = resolve(typeof input === 'string' && input.trim() ? input : process.cwd());
  const info = await stat(cwd);
  if (!info.isDirectory()) throw new Error(`cwd is not a directory: ${cwd}`);
  return cwd;
}

function storeRoot(cwd: string): string { return join(cwd, '.nova', 'skills'); }
function indexPath(cwd: string): string { return join(storeRoot(cwd), '_index.json'); }
function legacyStorePath(cwd: string): string { return join(cwd, '.nova', 'skills.json'); }
function skillDir(root: string, slug: string): string { return join(root, slug); }

function safeResolve(base: string, ...parts: string[]): string {
  const target = resolve(base, ...parts);
  const normalizedBase = resolve(base);
  if (target !== normalizedBase && !target.startsWith(normalizedBase + sep)) throw new Error(`path escapes skill store: ${target}`);
  return target;
}

function validateResourcePath(input: unknown): string {
  if (typeof input !== 'string' || !input.trim()) throw new Error('resource path must be a non-empty string.');
  const raw = input.replace(/\\/g, '/').trim();
  if (raw.includes('\0') || raw.includes('..') || raw.startsWith('/') || isAbsolute(raw)) throw new Error(`invalid resource path: ${input}`);
  if (raw.length > 180) throw new Error('resource path is too long (max 180 chars).');
  const parts = raw.split('/');
  if (parts.some(p => !p || p === '.' || p.startsWith('.') || !/^[A-Za-z0-9._-]+$/.test(p))) throw new Error(`invalid resource path: ${input}`);
  return parts.join('/');
}

function emptyIndex(): SkillIndex {
  const now = nowIso();
  return { version: INDEX_VERSION, createdAt: now, updatedAt: now, nextSeq: 1, skills: [], audit: [] };
}

function nextId(index: SkillIndex, slug: string): string {
  const seq = index.nextSeq++;
  return `skill_${slug}_${seq.toString(36).padStart(4, '0')}`;
}

function uniqueSlug(index: SkillIndex, base: string): string {
  const existing = new Set(index.skills.map(s => s.slug));
  const root = validateSlug(base);
  if (!existing.has(root)) return root;
  for (let i = 2; i <= 999; i++) {
    const candidate = validateSlug(`${root.slice(0, 90)}-${i}`);
    if (!existing.has(candidate)) return candidate;
  }
  throw new Error(`could not generate unique slug for ${base}`);
}

function renderYamlList(key: string, values: string[]): string[] {
  if (values.length === 0) return [`${key}: []`];
  return [`${key}:`, ...values.map(v => `  - ${JSON.stringify(v)}`)];
}

function renderSkillMd(meta: Omit<IndexSkill, 'path' | 'metadataPath' | 'skillDir' | 'contentHash' | 'createdAt' | 'updatedAt' | 'archivedAt'>, body: string): string {
  const frontmatter = [
    '---',
    `name: ${JSON.stringify(meta.slug)}`,
    `display_name: ${JSON.stringify(meta.name)}`,
    `description: ${JSON.stringify(meta.description)}`,
    `status: ${meta.status}`,
    `version: ${meta.version}`,
    ...renderYamlList('tags', meta.tags),
    ...renderYamlList('aliases', meta.aliases),
    ...renderYamlList('domains', meta.domains),
    ...renderYamlList('capabilities', meta.capabilities),
    ...renderYamlList('positive_triggers', meta.positiveTriggers),
    ...renderYamlList('negative_triggers', meta.negativeTriggers),
    '---',
    '',
  ].join('\n');
  return `${frontmatter}${body.trim()}\n`;
}

function stripFrontmatter(markdown: string): string {
  if (!markdown.startsWith('---')) return markdown.trim();
  const end = markdown.indexOf('\n---', 3);
  if (end === -1) return markdown.trim();
  return markdown.slice(markdown.indexOf('\n', end + 4) + 1).trim();
}

function validateIndexSkill(value: any): IndexSkill {
  if (!value || typeof value !== 'object') throw new Error('index skill is invalid.');
  const slug = validateSlug(value.slug);
  const id = typeof value.id === 'string' ? value.id : '';
  if (!new RegExp(`^skill_${slug}_[a-z0-9]{4,}$`).test(id)) throw new Error(`invalid skill id for ${slug}: ${id}`);
  if (!isStatus(value.status)) throw new Error(`invalid status for ${slug}: ${value.status}`);
  return {
    id, slug,
    name: validateName(value.name),
    description: validateDescription(value.description),
    tags: validateTags(value.tags),
    aliases: validateTokenList(value.aliases, 'aliases'),
    domains: validateTokenList(value.domains, 'domains'),
    capabilities: validateTokenList(value.capabilities, 'capabilities'),
    positiveTriggers: validateTriggers(value.positiveTriggers, 'positiveTriggers'),
    negativeTriggers: validateTriggers(value.negativeTriggers, 'negativeTriggers'),
    status: value.status,
    version: Math.max(1, Number.isInteger(value.version) ? value.version : 1),
    skillDir: typeof value.skillDir === 'string' ? value.skillDir : slug,
    path: typeof value.path === 'string' ? value.path : `${slug}/SKILL.md`,
    metadataPath: typeof value.metadataPath === 'string' ? value.metadataPath : `${slug}/metadata.json`,
    contentHash: typeof value.contentHash === 'string' ? value.contentHash : '',
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : nowIso(),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : nowIso(),
    archivedAt: typeof value.archivedAt === 'string' ? value.archivedAt : undefined,
  };
}

function validateAudit(input: any): AuditEvent[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new Error('audit must be an array.');
  return input.slice(-MAX_AUDIT).map((e, idx) => {
    if (!e || typeof e !== 'object') throw new Error(`audit[${idx}] is invalid.`);
    if (!['create', 'update', 'archive', 'remove', 'migrate'].includes(e.action)) throw new Error(`audit[${idx}] has invalid action.`);
    return {
      at: typeof e.at === 'string' ? e.at : nowIso(),
      action: e.action,
      skillId: typeof e.skillId === 'string' ? e.skillId : undefined,
      slug: typeof e.slug === 'string' ? e.slug : undefined,
      version: Number.isInteger(e.version) ? e.version : undefined,
      summary: typeof e.summary === 'string' ? e.summary.slice(0, 1000) : e.action,
      changes: Array.isArray(e.changes) ? e.changes.map((c: unknown) => String(c).slice(0, 120)).slice(0, 20) : undefined,
    };
  });
}

function validateIndex(value: any): SkillIndex {
  if (!value || typeof value !== 'object') throw new Error('skill index is not a JSON object.');
  if (value.version !== INDEX_VERSION) throw new Error(`unsupported skill index version: ${value.version}`);
  if (!Array.isArray(value.skills)) throw new Error('skills must be an array.');
  if (value.skills.length > MAX_SKILLS) throw new Error(`too many skills (${value.skills.length}, max ${MAX_SKILLS}).`);
  const skills = value.skills.map(validateIndexSkill);
  const slugs = new Set<string>();
  const ids = new Set<string>();
  for (const skill of skills) {
    if (slugs.has(skill.slug)) throw new Error(`duplicate skill slug: ${skill.slug}`);
    if (ids.has(skill.id)) throw new Error(`duplicate skill id: ${skill.id}`);
    slugs.add(skill.slug); ids.add(skill.id);
  }
  return {
    version: INDEX_VERSION,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : nowIso(),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : nowIso(),
    nextSeq: Math.max(1, Number.isInteger(value.nextSeq) ? value.nextSeq : skills.length + 1),
    skills,
    audit: validateAudit(value.audit),
  };
}

function validateResources(value: any): ResourceFile[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('resources must be an array.');
  return value.map((r, idx) => {
    if (!r || typeof r !== 'object') throw new Error(`resources[${idx}] is invalid.`);
    if (!isCategory(r.category)) throw new Error(`resources[${idx}] has invalid category.`);
    return {
      category: r.category,
      path: validateResourcePath(r.path),
      size: Number.isInteger(r.size) ? r.size : 0,
      hash: typeof r.hash === 'string' ? r.hash : '',
      updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : nowIso(),
    };
  });
}

function validateVersions(value: any): SkillVersion[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('versions must be an array.');
  return value.slice(-MAX_VERSIONS).map((v, idx) => {
    if (!v || typeof v !== 'object') throw new Error(`versions[${idx}] is invalid.`);
    if (!['create', 'update', 'archive', 'migrate'].includes(v.action)) throw new Error(`versions[${idx}] has invalid action.`);
    return {
      version: Math.max(1, Number.isInteger(v.version) ? v.version : 1),
      at: typeof v.at === 'string' ? v.at : nowIso(),
      action: v.action,
      summary: typeof v.summary === 'string' ? v.summary.slice(0, 1000) : v.action,
      contentHash: typeof v.contentHash === 'string' ? v.contentHash : '',
      resourceCount: Number.isInteger(v.resourceCount) ? v.resourceCount : 0,
      changes: Array.isArray(v.changes) ? v.changes.map((c: unknown) => String(c).slice(0, 120)).slice(0, 20) : [],
    };
  });
}

function validateMetadata(value: any): SkillMetadata {
  const base = validateIndexSkill(value);
  return { ...base, resources: validateResources(value.resources), versions: validateVersions(value.versions) };
}

async function atomicWrite(path: string, content: string, maxBytes: number): Promise<void> {
  if (byteLength(content) > maxBytes) throw new Error(`content would exceed ${maxBytes} bytes: ${path}`);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, path);
}

async function writeIndex(cwd: string, index: SkillIndex): Promise<void> {
  index.updatedAt = nowIso();
  index.audit = index.audit.slice(-MAX_AUDIT);
  await atomicWrite(indexPath(cwd), JSON.stringify(index, null, 2) + '\n', MAX_INDEX_BYTES);
}

async function readJsonFile(path: string, maxBytes: number): Promise<any> {
  const info = await stat(path);
  if (!info.isFile()) throw new Error(`not a file: ${path}`);
  if (info.size > maxBytes) throw new Error(`file too large: ${path}`);
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeMetadata(root: string, meta: SkillMetadata): Promise<void> {
  meta.versions = meta.versions.slice(-MAX_VERSIONS);
  const path = safeResolve(root, meta.metadataPath);
  await atomicWrite(path, JSON.stringify(meta, null, 2) + '\n', MAX_METADATA_BYTES);
}

async function readMetadata(root: string, indexSkill: IndexSkill): Promise<SkillMetadata> {
  const metadataPath = safeResolve(root, indexSkill.metadataPath);
  const value = await readJsonFile(metadataPath, MAX_METADATA_BYTES);
  const meta = validateMetadata(value);
  if (meta.id !== indexSkill.id || meta.slug !== indexSkill.slug) throw new Error(`metadata mismatch for ${indexSkill.slug}`);
  return meta;
}

async function ensureSkillDirs(root: string, slug: string): Promise<void> {
  const dir = skillDir(root, slug);
  await mkdir(dir, { recursive: true });
  for (const category of resourceCategories) await mkdir(join(dir, category), { recursive: true });
}

function audit(index: SkillIndex, event: AuditEvent): void {
  index.audit.push(event);
  index.audit = index.audit.slice(-MAX_AUDIT);
}

function versionEntry(meta: SkillMetadata, action: SkillVersion['action'], summary: string, changes: string[]): SkillVersion {
  return { version: meta.version, at: nowIso(), action, summary, contentHash: meta.contentHash, resourceCount: meta.resources.length, changes };
}

function toIndexSkill(meta: SkillMetadata): IndexSkill {
  const { resources: _r, versions: _v, ...indexSkill } = meta;
  return indexSkill;
}

async function writeSkillMarkdown(root: string, meta: IndexSkill, body: string): Promise<string> {
  const md = renderSkillMd(meta, body);
  if (md.length > MAX_SKILL_MD_CHARS + 5_000) throw new Error('rendered SKILL.md is too large.');
  const path = safeResolve(root, meta.path);
  await atomicWrite(path, md, MAX_METADATA_BYTES);
  return md;
}

async function readSkillMarkdown(root: string, meta: SkillMetadata | IndexSkill): Promise<string> {
  const path = safeResolve(root, meta.path);
  const info = await stat(path);
  if (!info.isFile()) throw new Error(`SKILL.md missing for ${meta.slug}`);
  if (info.size > MAX_METADATA_BYTES) throw new Error(`SKILL.md too large for ${meta.slug}`);
  return await readFile(path, 'utf8');
}

function validateResourceMap(input: unknown): Partial<Record<ResourceCategory, ResourceInput[]>> {
  if (input === undefined || input === null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('resources must be an object keyed by category.');
  const out: Partial<Record<ResourceCategory, ResourceInput[]>> = {};
  let count = 0;
  for (const [category, rawList] of Object.entries(input as Record<string, unknown>)) {
    if (!isCategory(category)) throw new Error(`invalid resource category: ${category}. Allowed: ${resourceCategories.join(', ')}`);
    if (!Array.isArray(rawList)) throw new Error(`resources.${category} must be an array.`);
    out[category] = rawList.map((raw, idx) => {
      if (!raw || typeof raw !== 'object') throw new Error(`resources.${category}[${idx}] is invalid.`);
      const file = raw as { path?: unknown; content?: unknown };
      if (typeof file.content !== 'string') throw new Error(`resources.${category}[${idx}].content must be a string.`);
      if (file.content.includes('\0')) throw new Error(`resources.${category}[${idx}].content contains NUL byte.`);
      if (file.content.length > MAX_RESOURCE_CHARS) throw new Error(`resources.${category}[${idx}].content too long (max ${MAX_RESOURCE_CHARS}).`);
      count++;
      return { path: validateResourcePath(file.path), content: file.content };
    });
  }
  if (count > MAX_RESOURCE_FILES_PER_CALL) throw new Error(`too many resource files in one call (max ${MAX_RESOURCE_FILES_PER_CALL}).`);
  return out;
}

async function writeResources(root: string, meta: SkillMetadata, resourcesInput: unknown, replaceResources: boolean): Promise<{ resources: ResourceFile[]; changed: boolean }> {
  const resources = validateResourceMap(resourcesInput);
  const hasInput = Object.values(resources).some(list => list && list.length > 0);
  if (!hasInput && !replaceResources) return { resources: meta.resources, changed: false };
  const dir = safeResolve(root, meta.skillDir);
  if (replaceResources) {
    for (const category of resourceCategories) {
      await rm(safeResolve(dir, category), { recursive: true, force: true });
      await mkdir(safeResolve(dir, category), { recursive: true });
    }
  }
  const manifest = replaceResources ? [] : [...meta.resources];
  let changed = replaceResources;
  for (const category of resourceCategories) {
    for (const file of resources[category] ?? []) {
      const target = safeResolve(dir, category, file.path);
      await mkdir(dirname(target), { recursive: true });
      await atomicWrite(target, file.content, MAX_RESOURCE_CHARS * 2);
      const entry: ResourceFile = { category, path: file.path, size: byteLength(file.content), hash: hashText(file.content), updatedAt: nowIso() };
      const idx = manifest.findIndex(r => r.category === category && r.path === file.path);
      if (idx === -1) manifest.push(entry);
      else manifest[idx] = entry;
      changed = true;
    }
  }
  return { resources: manifest.sort((a, b) => `${a.category}/${a.path}`.localeCompare(`${b.category}/${b.path}`)), changed };
}

async function loadResourceContents(root: string, meta: SkillMetadata, input: any): Promise<Array<ResourceFile & { content: string }>> {
  if (input.includeResources !== true) return [];
  const categoryFilter = input.resourceCategory;
  if (categoryFilter !== undefined && !isCategory(categoryFilter)) throw new Error(`invalid resourceCategory: ${categoryFilter}`);
  const maxChars = clampNumber(input.maxResourceChars, MAX_RESOURCE_LOAD_CHARS, 1_000, MAX_RESOURCE_LOAD_CHARS);
  const dir = safeResolve(root, meta.skillDir);
  let used = 0;
  const loaded: Array<ResourceFile & { content: string }> = [];
  for (const resource of meta.resources) {
    if (categoryFilter && resource.category !== categoryFilter) continue;
    const path = safeResolve(dir, resource.category, resource.path);
    const info = await stat(path);
    if (!info.isFile()) continue;
    if (info.size > MAX_RESOURCE_CHARS * 2) throw new Error(`resource too large to load: ${resource.category}/${resource.path}`);
    const content = await readFile(path, 'utf8');
    if (used + content.length > maxChars) break;
    used += content.length;
    loaded.push({ ...resource, content });
  }
  return loaded;
}

async function migrateLegacyIfNeeded(cwd: string): Promise<void> {
  const idxPath = indexPath(cwd);
  try { await stat(idxPath); return; } catch (err: any) { if (err?.code !== 'ENOENT') throw err; }
  const legacyPath = legacyStorePath(cwd);
  try { await stat(legacyPath); } catch (err: any) { if (err?.code === 'ENOENT') return; throw err; }
  const legacy = await readJsonFile(legacyPath, MAX_INDEX_BYTES);
  if (!Array.isArray(legacy.skills)) return;

  const index = emptyIndex();
  const root = storeRoot(cwd);
  await mkdir(root, { recursive: true });
  for (const oldSkill of legacy.skills.slice(0, MAX_SKILLS)) {
    const name = validateName(oldSkill.name || oldSkill.slug || 'Migrated Skill');
    const slug = uniqueSlug(index, validateSlug(oldSkill.slug || slugify(name)));
    const status = isStatus(oldSkill.status) ? oldSkill.status : 'active';
    const now = nowIso();
    await ensureSkillDirs(root, slug);
    const body = validateSkillBody(oldSkill.content || `# ${name}\n\n${oldSkill.description || ''}`);
    const partial = {
      id: nextId(index, slug), slug, name,
      description: validateDescription(oldSkill.description || `Migrated skill ${name}`),
      tags: validateTags(oldSkill.tags),
      aliases: [], domains: [], capabilities: [], positiveTriggers: [], negativeTriggers: [],
      status, version: Math.max(1, Number.isInteger(oldSkill.version) ? oldSkill.version : 1),
      skillDir: slug, path: `${slug}/SKILL.md`, metadataPath: `${slug}/metadata.json`,
      contentHash: '', createdAt: oldSkill.createdAt || now, updatedAt: now, archivedAt: oldSkill.archivedAt,
    } satisfies IndexSkill;
    const md = await writeSkillMarkdown(root, partial, body);
    const meta: SkillMetadata = { ...partial, contentHash: hashText(md), resources: [], versions: [] };
    meta.versions.push(versionEntry(meta, 'migrate', 'Migrated from legacy .nova/skills.json', ['legacy-migration']));
    await writeMetadata(root, meta);
    index.skills.push(toIndexSkill(meta));
    audit(index, { at: now, action: 'migrate', skillId: meta.id, slug: meta.slug, version: meta.version, summary: 'Migrated from legacy .nova/skills.json', changes: ['legacy-migration'] });
  }
  await atomicWrite(join(root, 'LEGACY_MIGRATION.md'), `# Legacy skill migration\n\nMigrated from ${legacyPath} on ${nowIso()}. The legacy file was left untouched.\n`, 50_000);
  await writeIndex(cwd, index);
}

async function readIndex(cwd: string): Promise<SkillIndex> {
  await migrateLegacyIfNeeded(cwd);
  try {
    return validateIndex(await readJsonFile(indexPath(cwd), MAX_INDEX_BYTES));
  } catch (err: any) {
    if (err?.code === 'ENOENT') return emptyIndex();
    if (err instanceof SyntaxError) throw new Error(`skill index is corrupted JSON: ${indexPath(cwd)}`);
    throw err;
  }
}

function findIndexSkill(index: SkillIndex, idOrSlug: unknown, includeArchived = false): IndexSkill {
  const key = validateIdOrSlug(idOrSlug);
  const skill = index.skills.find(s => s.id === key || s.slug === key);
  if (!skill) throw new Error(`skill not found: ${key}`);
  if (skill.status === 'archived' && !includeArchived) throw new Error(`skill is archived: ${skill.slug}. Pass includeArchived=true to access archived skills.`);
  return skill;
}

function filtersFromInput(input: any): { status?: SkillStatus; tag?: string; includeArchived: boolean; limit: number } {
  const status = input.status === undefined ? undefined : input.status;
  if (status !== undefined && !isStatus(status)) throw new Error(`invalid status: ${status}. Allowed: ${statuses.join(', ')}`);
  const tag = input.tag === undefined ? undefined : validateTags([input.tag])[0];
  return { status, tag, includeArchived: input.includeArchived === true, limit: clampNumber(input.limit, DEFAULT_LIMIT, 1, MAX_SKILLS) };
}

function listSkills(index: SkillIndex, input: any): IndexSkill[] {
  const filters = filtersFromInput(input);
  return index.skills.filter(skill => {
    if (!filters.includeArchived && skill.status === 'archived') return false;
    if (filters.status && skill.status !== filters.status) return false;
    if (filters.tag && !skill.tags.includes(filters.tag)) return false;
    return true;
  }).sort((a, b) => a.slug.localeCompare(b.slug)).slice(0, filters.limit);
}

function tokenize(query: string): string[] {
  return query.toLowerCase().split(/[^a-z0-9_.-]+/).map(s => s.trim()).filter(Boolean).slice(0, 30);
}

function scoreField(value: string | string[], term: string, exact: number, contains: number): number {
  const values = Array.isArray(value) ? value : [value];
  let score = 0;
  for (const v of values.map(x => x.toLowerCase())) {
    if (v === term) score += exact;
    else if (v.includes(term)) score += contains;
  }
  return score;
}

async function searchSkills(cwd: string, index: SkillIndex, input: any): Promise<SearchHit[]> {
  if (typeof input.query !== 'string' || !input.query.trim()) throw new Error('query is required for search.');
  const query = input.query.trim();
  if (query.length > 500) throw new Error('query is too long (max 500 chars).');
  const terms = tokenize(query);
  if (terms.length === 0) throw new Error('query must contain searchable text.');
  const filters = filtersFromInput(input);
  const root = storeRoot(cwd);
  const hits: SearchHit[] = [];
  for (const skill of index.skills) {
    if (!filters.includeArchived && skill.status === 'archived') continue;
    if (filters.status && skill.status !== filters.status) continue;
    if (filters.tag && !skill.tags.includes(filters.tag)) continue;
    const body = await readSkillMarkdown(root, skill).catch(() => '');
    const bodyText = stripFrontmatter(body).toLowerCase();
    const matched = new Set<string>();
    let score = 0;
    for (const term of terms) {
      const before = score;
      score += scoreField(skill.slug, term, 120, 50);
      if (score > before) matched.add('slug');
      const s1 = score;
      score += scoreField(skill.name, term, 90, 35);
      if (score > s1) matched.add('name');
      const s2 = score;
      score += scoreField(skill.aliases, term, 80, 32);
      if (score > s2) matched.add('aliases');
      const s3 = score;
      score += scoreField(skill.tags, term, 55, 20) + scoreField(skill.domains, term, 45, 18) + scoreField(skill.capabilities, term, 45, 18);
      if (score > s3) matched.add('taxonomy');
      const s4 = score;
      score += scoreField(skill.positiveTriggers, term, 35, 14) + scoreField(skill.description, term, 30, 12);
      if (score > s4) matched.add('description/triggers');
      const s5 = score;
      if (bodyText.includes(term)) score += 4;
      if (score > s5) matched.add('content');
      if (skill.negativeTriggers.some(t => t.toLowerCase().includes(term))) {
        score -= 25;
        matched.add('negative-trigger-penalty');
      }
    }
    if (score > 0) hits.push({ skill, score, matchedFields: Array.from(matched), snippet: makeSnippet(`${skill.description}\n${skill.positiveTriggers.join('\n')}\n${bodyText}`, terms) });
  }
  return hits.sort((a, b) => b.score - a.score || a.skill.slug.localeCompare(b.skill.slug)).slice(0, filters.limit);
}

function makeSnippet(text: string, terms: string[]): string {
  const flat = text.replace(/\s+/g, ' ');
  const lower = flat.toLowerCase();
  let pos = -1;
  for (const term of terms) { pos = lower.indexOf(term); if (pos !== -1) break; }
  if (pos === -1) return flat.slice(0, 260);
  return flat.slice(Math.max(0, pos - 120), Math.min(flat.length, pos + 240)).trim();
}

function summaryLine(skill: IndexSkill): string {
  const tags = skill.tags.length ? ` #${skill.tags.join(' #')}` : '';
  const aliases = skill.aliases.length ? ` aliases=${skill.aliases.join(',')}` : '';
  return `- ${skill.slug} (${skill.id}) [${skill.status}] v${skill.version} — ${skill.name}${tags}${aliases}\n  ${skill.description}`;
}

function formatList(path: string, index: SkillIndex, skills: IndexSkill[]): string {
  const active = index.skills.filter(s => s.status === 'active').length;
  const draft = index.skills.filter(s => s.status === 'draft').length;
  const archived = index.skills.filter(s => s.status === 'archived').length;
  const lines = [`## Skills`, `Store: ${path}`, `Total: ${index.skills.length} | active: ${active} | draft: ${draft} | archived: ${archived}`, `Showing: ${skills.length}`, ''];
  lines.push(skills.length ? skills.map(summaryLine).join('\n') : '(no skills)');
  return lines.join('\n');
}

function formatSearch(path: string, hits: SearchHit[]): string {
  const lines = [`## Skill search`, `Store: ${path}`, `Results: ${hits.length}`, ''];
  if (hits.length === 0) lines.push('(no matches)');
  for (const hit of hits) {
    lines.push(`### ${hit.skill.slug} — score ${hit.score}`);
    lines.push(summaryLine(hit.skill));
    lines.push(`  matched: ${hit.matchedFields.join(', ') || '(none)'}`);
    lines.push(`  snippet: ${hit.snippet}`);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

function formatMetadata(meta: SkillMetadata, md?: string, resources?: Array<ResourceFile & { content: string }>): string {
  const lines = [
    `ID: ${meta.id}`,
    `Slug: ${meta.slug}`,
    `Name: ${meta.name}`,
    `Status: ${meta.status}`,
    `Version: ${meta.version}`,
    `Tags: ${meta.tags.join(', ') || '(none)'}`,
    `Aliases: ${meta.aliases.join(', ') || '(none)'}`,
    `Domains: ${meta.domains.join(', ') || '(none)'}`,
    `Capabilities: ${meta.capabilities.join(', ') || '(none)'}`,
    `Created: ${meta.createdAt}`,
    `Updated: ${meta.updatedAt}`,
    meta.archivedAt ? `Archived: ${meta.archivedAt}` : undefined,
    `Content hash: ${meta.contentHash}`,
    '',
    `Description: ${meta.description}`,
    '',
    'Positive triggers:',
    ...(meta.positiveTriggers.length ? meta.positiveTriggers.map(t => `- ${t}`) : ['- (none)']),
    '',
    'Negative triggers:',
    ...(meta.negativeTriggers.length ? meta.negativeTriggers.map(t => `- ${t}`) : ['- (none)']),
    '',
    'Resources:',
    ...(meta.resources.length ? meta.resources.map(r => `- ${r.category}/${r.path} (${r.size} bytes, ${r.hash.slice(0, 12)})`) : ['- (none)']),
    '',
    'Versions:',
    ...(meta.versions.length ? meta.versions.slice(-10).reverse().map(v => `- v${v.version} ${v.at} ${v.action}: ${v.summary} | ${v.changes.join(', ')}`) : ['- (none)']),
  ].filter((l): l is string => l !== undefined);
  if (md !== undefined) lines.push('', 'SKILL.md:', '```markdown', md, '```');
  if (resources && resources.length > 0) {
    lines.push('', 'Loaded resources:');
    for (const r of resources) lines.push(`\n### ${r.category}/${r.path}\n\`\`\`text\n${r.content}\n\`\`\``);
  }
  return lines.join('\n');
}

function changedFields(before: SkillMetadata, after: SkillMetadata, bodyChanged: boolean, resourcesChanged: boolean): string[] {
  const changes: string[] = [];
  for (const key of ['name', 'description', 'status'] as const) if (before[key] !== after[key]) changes.push(key);
  for (const key of ['tags', 'aliases', 'domains', 'capabilities', 'positiveTriggers', 'negativeTriggers'] as const) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changes.push(key);
  }
  if (bodyChanged) changes.push('SKILL.md');
  if (resourcesChanged) changes.push('resources');
  return changes;
}

export const skillTool: NovaTool = {
  name: 'skill',
  description: 'Manage folder-based local Nova skills under .nova/skills: list/search/get/load/create/update/archive/remove with SKILL.md, metadata.json, references/templates/models/scripts/examples/evals/tests, CHANGELOG.md, validated auto-suggestion metadata, migration from legacy .nova/skills.json, audit/versioning, and strict path/no-execution guards.',
  inputSchema: z.object({
    action: z.enum(['list', 'search', 'get', 'load', 'create', 'update', 'archive', 'remove']).describe('Skill operation.'),
    cwd: z.string().optional().describe('Project directory for .nova/skills storage. Default: current process cwd.'),
    idOrSlug: z.string().optional().describe('Skill id or slug for get/load/update/archive/remove. Must not be a path.'),
    name: z.string().optional(),
    description: z.string().optional(),
    content: z.string().optional().describe('Skill body instructions; stored in generated SKILL.md with metadata frontmatter.'),
    tags: z.array(z.string()).optional(),
    aliases: z.array(z.string()).optional(),
    domains: z.array(z.string()).optional(),
    capabilities: z.array(z.string()).optional(),
    positiveTriggers: z.array(z.string()).optional(),
    negativeTriggers: z.array(z.string()).optional(),
    resources: z.record(z.array(z.object({ path: z.string(), content: z.string() }))).optional().describe('Optional text resources grouped by references/templates/models/scripts/examples/evals/tests. Stored only; never executed.'),
    replaceResources: z.boolean().optional().describe('For update: replace all resource dirs before writing provided resources.'),
    status: z.enum(statuses).optional(),
    tag: z.string().optional().describe('Tag filter for list/search.'),
    query: z.string().optional().describe('Search query.'),
    includeArchived: z.boolean().optional(),
    includeContent: z.boolean().optional().describe('For get: include SKILL.md. load always includes it.'),
    includeResources: z.boolean().optional().describe('For get/load: include managed resource contents, bounded by maxResourceChars.'),
    resourceCategory: z.enum(resourceCategories).optional().describe('Optional resource category filter when includeResources=true.'),
    maxResourceChars: z.number().int().min(1000).max(MAX_RESOURCE_LOAD_CHARS).optional(),
    limit: z.number().int().min(1).max(MAX_SKILLS).optional(),
    summary: z.string().optional(),
    confirm: z.boolean().optional().describe('Required true for remove.'),
    format: z.enum(['text', 'json']).optional(),
  }),
  execute: async (input) => {
    try {
      const cwd = await validateCwd(input.cwd);
      const root = storeRoot(cwd);
      const idxPath = indexPath(cwd);
      const index = await readIndex(cwd);
      const action = input.action as string;
      let changed = false;
      let output: any = {};
      let text = '';

      if (action === 'list') {
        const skills = listSkills(index, input);
        output = { action, store: idxPath, skills, audit: index.audit.slice(-10) };
        text = formatList(idxPath, index, skills);
      } else if (action === 'search') {
        const hits = await searchSkills(cwd, index, input);
        output = { action, store: idxPath, results: hits };
        text = formatSearch(idxPath, hits);
      } else if (action === 'get' || action === 'load') {
        const skill = findIndexSkill(index, input.idOrSlug, input.includeArchived === true);
        const meta = await readMetadata(root, skill);
        const md = action === 'load' || input.includeContent === true ? await readSkillMarkdown(root, meta) : undefined;
        const resources = await loadResourceContents(root, meta, input);
        output = { action, store: idxPath, skill: meta, content: md, resources };
        text = `## Skill ${action}\nStore: ${idxPath}\n\n${formatMetadata(meta, md, resources)}`;
        if (action === 'load') text += '\n\nNote: loaded text is for model context only. The skill tool never executes code, commands, scripts, or external paths.';
      } else if (action === 'create') {
        if (index.skills.length >= MAX_SKILLS) throw new Error(`cannot create skill: max ${MAX_SKILLS} reached.`);
        const name = validateName(input.name);
        const slug = uniqueSlug(index, slugify(name));
        await ensureSkillDirs(root, slug);
        const now = nowIso();
        const status = input.status === undefined ? 'active' : input.status;
        if (!isStatus(status)) throw new Error(`invalid status: ${status}. Allowed: ${statuses.join(', ')}`);
        const partial: SkillMetadata = {
          id: nextId(index, slug), slug, name,
          description: validateDescription(input.description),
          tags: validateTags(input.tags),
          aliases: validateTokenList(input.aliases, 'aliases'),
          domains: validateTokenList(input.domains, 'domains'),
          capabilities: validateTokenList(input.capabilities, 'capabilities'),
          positiveTriggers: validateTriggers(input.positiveTriggers, 'positiveTriggers'),
          negativeTriggers: validateTriggers(input.negativeTriggers, 'negativeTriggers'),
          status, version: 1, skillDir: slug, path: `${slug}/SKILL.md`, metadataPath: `${slug}/metadata.json`,
          contentHash: '', createdAt: now, updatedAt: now, archivedAt: status === 'archived' ? now : undefined,
          resources: [], versions: [],
        };
        const md = await writeSkillMarkdown(root, partial, validateSkillBody(input.content));
        partial.contentHash = hashText(md);
        const resourceResult = await writeResources(root, partial, input.resources, false);
        partial.resources = resourceResult.resources;
        const summary = validateSummary(input.summary, 'Skill created');
        partial.versions.push(versionEntry(partial, 'create', summary, ['folder', 'SKILL.md', 'metadata', ...(resourceResult.changed ? ['resources'] : [])]));
        await writeMetadata(root, partial);
        await atomicWrite(safeResolve(root, partial.skillDir, 'CHANGELOG.md'), `# Changelog — ${partial.name}\n\n- v1 ${now}: ${summary}\n`, 100_000);
        index.skills.push(toIndexSkill(partial));
        audit(index, { at: now, action: 'create', skillId: partial.id, slug: partial.slug, version: partial.version, summary, changes: ['folder', 'SKILL.md', 'metadata', ...(resourceResult.changed ? ['resources'] : [])] });
        text = `## Skill create\nStore: ${idxPath}\n\nCreated folder: .nova/skills/${partial.slug}\n\n${formatMetadata(partial)}`;
        output = { action, store: idxPath, skill: partial };
        changed = true;
      } else if (action === 'update') {
        const indexSkill = findIndexSkill(index, input.idOrSlug, true);
        const meta = await readMetadata(root, indexSkill);
        const before: SkillMetadata = JSON.parse(JSON.stringify(meta));
        if (input.name !== undefined) meta.name = validateName(input.name);
        if (input.description !== undefined) meta.description = validateDescription(input.description);
        if (input.tags !== undefined) meta.tags = validateTags(input.tags);
        if (input.aliases !== undefined) meta.aliases = validateTokenList(input.aliases, 'aliases');
        if (input.domains !== undefined) meta.domains = validateTokenList(input.domains, 'domains');
        if (input.capabilities !== undefined) meta.capabilities = validateTokenList(input.capabilities, 'capabilities');
        if (input.positiveTriggers !== undefined) meta.positiveTriggers = validateTriggers(input.positiveTriggers, 'positiveTriggers');
        if (input.negativeTriggers !== undefined) meta.negativeTriggers = validateTriggers(input.negativeTriggers, 'negativeTriggers');
        if (input.status !== undefined) {
          if (!isStatus(input.status)) throw new Error(`invalid status: ${input.status}. Allowed: ${statuses.join(', ')}`);
          meta.status = input.status;
          meta.archivedAt = input.status === 'archived' ? (meta.archivedAt || nowIso()) : undefined;
        }
        const oldMd = await readSkillMarkdown(root, meta);
        let bodyChanged = false;
        let md = oldMd;
        if (input.content !== undefined) {
          md = await writeSkillMarkdown(root, meta, validateSkillBody(input.content));
          bodyChanged = stripFrontmatter(oldMd) !== validateSkillBody(input.content);
        } else if (changedFields(before, meta, false, false).length > 0) {
          md = await writeSkillMarkdown(root, meta, stripFrontmatter(oldMd));
        }
        meta.contentHash = hashText(md);
        const resourceResult = await writeResources(root, meta, input.resources, input.replaceResources === true);
        meta.resources = resourceResult.resources;
        const changes = changedFields(before, meta, bodyChanged, resourceResult.changed);
        if (changes.length === 0) throw new Error('update requires at least one changed field.');
        meta.version += 1;
        meta.updatedAt = nowIso();
        const summary = validateSummary(input.summary, 'Skill updated');
        meta.versions.push(versionEntry(meta, 'update', summary, changes));
        await writeMetadata(root, meta);
        await atomicWrite(safeResolve(root, meta.skillDir, 'CHANGELOG.md'), `# Changelog — ${meta.name}\n\n${meta.versions.map(v => `- v${v.version} ${v.at}: ${v.summary} (${v.changes.join(', ')})`).join('\n')}\n`, 200_000);
        const idx = index.skills.findIndex(s => s.id === meta.id);
        index.skills[idx] = toIndexSkill(meta);
        audit(index, { at: meta.updatedAt, action: 'update', skillId: meta.id, slug: meta.slug, version: meta.version, summary, changes });
        text = `## Skill update\nStore: ${idxPath}\n\nUpdated folder: .nova/skills/${meta.slug}\nChanges: ${changes.join(', ')}\n\n${formatMetadata(meta)}`;
        output = { action, store: idxPath, skill: meta, changes };
        changed = true;
      } else if (action === 'archive') {
        const indexSkill = findIndexSkill(index, input.idOrSlug, true);
        const meta = await readMetadata(root, indexSkill);
        if (meta.status === 'archived') throw new Error(`skill already archived: ${meta.slug}`);
        meta.status = 'archived'; meta.archivedAt = nowIso(); meta.updatedAt = meta.archivedAt; meta.version += 1;
        const md = await writeSkillMarkdown(root, meta, stripFrontmatter(await readSkillMarkdown(root, meta)));
        meta.contentHash = hashText(md);
        const summary = validateSummary(input.summary, 'Skill archived');
        meta.versions.push(versionEntry(meta, 'archive', summary, ['status']));
        await writeMetadata(root, meta);
        const idx = index.skills.findIndex(s => s.id === meta.id);
        index.skills[idx] = toIndexSkill(meta);
        audit(index, { at: meta.updatedAt, action: 'archive', skillId: meta.id, slug: meta.slug, version: meta.version, summary, changes: ['status'] });
        text = `## Skill archive\nStore: ${idxPath}\n\nArchived: ${meta.slug} v${meta.version}`;
        output = { action, store: idxPath, skill: meta };
        changed = true;
      } else if (action === 'remove') {
        if (input.confirm !== true) throw new Error('remove requires confirm=true.');
        const indexSkill = findIndexSkill(index, input.idOrSlug, true);
        const meta = await readMetadata(root, indexSkill).catch(() => undefined);
        await rm(safeResolve(root, indexSkill.skillDir), { recursive: true, force: true });
        index.skills = index.skills.filter(s => s.id !== indexSkill.id);
        const summary = validateSummary(input.summary, 'Skill removed');
        audit(index, { at: nowIso(), action: 'remove', skillId: indexSkill.id, slug: indexSkill.slug, version: indexSkill.version, summary, changes: ['folder-removed'] });
        text = `## Skill remove\nStore: ${idxPath}\n\nRemoved folder: .nova/skills/${indexSkill.slug}\nAudit retained in _index.json.`;
        output = { action, store: idxPath, removed: meta ?? indexSkill };
        changed = true;
      } else {
        throw new Error(`unsupported skill action: ${action}`);
      }

      if (changed) await writeIndex(cwd, index);
      return input.format === 'json' ? JSON.stringify(output, null, 2) : text;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error in skill tool: ${msg}\nActions: list, search, get, load, create, update, archive, remove. Statuses: ${statuses.join(', ')}. Store is limited to .nova/skills; this tool never executes code or loads arbitrary external paths.`;
    }
  },
};
