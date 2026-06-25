import { cancel, confirm, intro, isCancel, note, outro, select, spinner, text } from '@clack/prompts';
import chalk from 'chalk';

import type { AgentConfig } from '../types.js';
import type { AgentRunSummary } from '../streaming/types.js';
import { StreamingEventLogStore } from '../streaming/log.js';
import { ApprovalManager } from '../approval/index.js';
import { CurrentSessionStore, SessionRunManager, SessionStore } from '../session/index.js';
import { buildProductionReadinessReport } from '../production/readiness.js';
import { initProjectConfig, readProjectConfig } from '../config/index.js';
import { builtInProfileCatalogue } from '../profiles/catalogue.js';
import { listProviderProfiles, providerDoctor, resolveProviderRuntime } from '../providers/index.js';
import { redactString } from '../policy/redact.js';
import { TuiReplayRenderer } from './renderer.js';

export interface InteractiveTuiContext {
  config: AgentConfig;
  runPrompt: (prompt: string, options: { eventLog: boolean }) => Promise<AgentRunSummary | undefined>;
}

export type TuiRouteId = 'dashboard' | 'run' | 'sessions' | 'config' | 'providers' | 'profiles' | 'logs' | 'diagnostics' | 'approvals';

export interface TuiPanelState {
  id: TuiRouteId;
  label: string;
  hotkey: string;
  status: 'ready' | 'warning' | 'blocked' | 'idle';
  summary: string;
  detail: string[];
  actions: string[];
}

export interface TuiDashboardSnapshot {
  title: string;
  shell: { mode: 'interactive' | 'non-interactive'; keyboard: string[]; navigation: string[] };
  config: { present: boolean; ok: boolean; path: string; errors: number };
  provider: { id: string; provider: string; model: string; protocol: string; apiKeyStatus: 'present' | 'missing'; ok: boolean; fallbackEnabled: boolean };
  profile: { id: string; name: string; mode: string; policyProfileId?: string };
  session: { currentSessionId?: string; currentRunId?: string; sessionCount: number; runCount: number; latestRunStatus?: string; approvalCount: number; pendingApprovalCount: number };
  streaming: { enabled: boolean; mode: string; eventLogEnabled: boolean; logCount: number; latestLogId?: string };
  readiness: { ready: boolean; blockers: number; criticalBlockers: number; warnings: number; publishReady: false };
  safety: { writeToolsDefault: 'disabled'; shellDefault: 'disabled'; autonomyDefault: 'disabled'; liveLlmDefault: 'disabled'; secretsDisplayed: false; rawNovaDisplayed: false; envOnlySecrets: true };
  panels: TuiPanelState[];
  actions: string[];
}

const PANEL_ORDER: Array<{ id: TuiRouteId; label: string; hotkey: string }> = [
  { id: 'dashboard', label: 'Dashboard', hotkey: 'd' },
  { id: 'run', label: 'Prompt streaming', hotkey: 'r' },
  { id: 'sessions', label: 'Sessions & runs', hotkey: 's' },
  { id: 'config', label: 'Onboarding/config', hotkey: 'c' },
  { id: 'providers', label: 'Providers/models', hotkey: 'p' },
  { id: 'profiles', label: 'Agent profiles', hotkey: 'a' },
  { id: 'logs', label: 'Logs/replay', hotkey: 'l' },
  { id: 'diagnostics', label: 'Diagnostics/readiness', hotkey: 'g' },
  { id: 'approvals', label: 'Safety approvals', hotkey: 'v' },
];

export async function buildTuiDashboardSnapshot(config: AgentConfig): Promise<TuiDashboardSnapshot> {
  const project = readProjectConfig();
  const providerRuntime = resolveProviderRuntime({ project: project.config, env: process.env });
  const provider = providerDoctor(providerRuntime, process.env);
  const sessionConfig = { ...config.session, enabled: true };
  const store = new SessionStore(sessionConfig);
  const currentStore = new CurrentSessionStore(sessionConfig);
  const current = await currentStore.get().catch(() => undefined);
  const sessions = await store.listSessions().catch(() => []);
  const runs = await store.listRuns().catch(() => []);
  const latestRun = runs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const approvals = await new ApprovalManager(sessionConfig).list().catch(() => []);
  const pendingApprovals = approvals.filter((item) => item.status === 'pending');
  const eventStore = new StreamingEventLogStore({ ...config.streaming?.eventLog, enabled: true });
  const logs = await eventStore.list().catch(() => []);
  const readiness = buildProductionReadinessReport();
  const profile = config.profile;
  const snapshotCore = {
    title: 'Nova TUI · Command Center Premium',
    shell: {
      mode: 'non-interactive' as const,
      keyboard: ['↑/↓ move', 'Enter open', 'b back', 'd dashboard', 'r run', 's sessions', 'q quit'],
      navigation: PANEL_ORDER.map((panel) => `${panel.hotkey}:${panel.label}`),
    },
    config: { present: project.present, ok: project.ok, path: project.path, errors: project.errors.length },
    provider: {
      id: provider.primary.id,
      provider: provider.primary.provider,
      model: provider.primary.model,
      protocol: provider.primary.protocol,
      apiKeyStatus: provider.apiKey.status,
      ok: provider.ok,
      fallbackEnabled: provider.fallback.enabled,
    },
    profile: { id: profile?.id ?? 'default', name: profile?.name ?? 'Nova default', mode: profile?.mode ?? 'root', policyProfileId: profile?.policyProfileId },
    session: {
      currentSessionId: current?.sessionId,
      currentRunId: current?.runId,
      sessionCount: sessions.length,
      runCount: runs.length,
      latestRunStatus: latestRun?.status,
      approvalCount: approvals.length,
      pendingApprovalCount: pendingApprovals.length,
    },
    streaming: { enabled: config.streaming?.enabled === true, mode: config.streaming?.mode ?? 'normal', eventLogEnabled: config.streaming?.eventLog?.enabled === true, logCount: logs.length, latestLogId: logs[0]?.logId },
    readiness: { ready: readiness.readiness.ready, blockers: readiness.readiness.blockedCount, criticalBlockers: readiness.readiness.criticalBlockedCount, warnings: readiness.readiness.warningCount, publishReady: readiness.installableNow.npmPublishReady },
    safety: { writeToolsDefault: 'disabled' as const, shellDefault: 'disabled' as const, autonomyDefault: 'disabled' as const, liveLlmDefault: 'disabled' as const, secretsDisplayed: false as const, rawNovaDisplayed: false as const, envOnlySecrets: true as const },
    actions: ['run prompt', 'sessions', 'configuration', 'providers', 'profiles', 'logs/replay', 'diagnostics', 'approvals'],
  };
  return { ...snapshotCore, panels: buildPanels(snapshotCore) };
}

export function renderTuiDashboardSnapshot(snapshot: TuiDashboardSnapshot): string {
  const lines: string[] = [];
  lines.push(chalk.cyanBright.bold(`╭─ ${snapshot.title} ─────────────────────────────────────╮`));
  lines.push(`│ ${badge(snapshot.config.ok, 'config valid', `${snapshot.config.errors} config error(s)`)} ${snapshot.config.present ? 'present' : 'missing'} · ${shortPath(snapshot.config.path)}`);
  lines.push(`│ ${badge(snapshot.provider.ok, 'provider ok', 'provider blocked')} ${snapshot.provider.id} · ${snapshot.provider.provider}/${snapshot.provider.model} · protocol=${snapshot.provider.protocol} · key=${snapshot.provider.apiKeyStatus}`);
  lines.push(`│ profile ${snapshot.profile.id} · ${snapshot.profile.name} · mode=${snapshot.profile.mode} · policy=${snapshot.profile.policyProfileId ?? 'default'}`);
  lines.push(`│ sessions ${snapshot.session.sessionCount} · runs ${snapshot.session.runCount} · current=${snapshot.session.currentSessionId ?? 'none'} · latest=${snapshot.session.latestRunStatus ?? 'none'}`);
  lines.push(`│ approvals pending=${snapshot.session.pendingApprovalCount} total=${snapshot.session.approvalCount} · streaming ${snapshot.streaming.enabled ? 'enabled' : 'disabled'} · mode=${snapshot.streaming.mode} · logs=${snapshot.streaming.logCount}`);
  lines.push(`│ readiness ${snapshot.readiness.ready ? chalk.green('ready') : chalk.red('blocked')} · blockers=${snapshot.readiness.blockers} · critical=${snapshot.readiness.criticalBlockers} · warnings=${snapshot.readiness.warnings} · publishReady=${snapshot.readiness.publishReady}`);
  lines.push(`│ safety writeTools=${snapshot.safety.writeToolsDefault} · shell=${snapshot.safety.shellDefault} · autonomy=${snapshot.safety.autonomyDefault} · liveLLM=${snapshot.safety.liveLlmDefault}`);
  lines.push(`│ safety secretsDisplayed=${snapshot.safety.secretsDisplayed} · rawNovaDisplayed=${snapshot.safety.rawNovaDisplayed} · envOnlySecrets=${snapshot.safety.envOnlySecrets}`);
  lines.push(chalk.cyanBright('╰──────────────────────────────────────────────────────────╯'));
  lines.push('');
  lines.push(chalk.bold('Keyboard shell'));
  lines.push(`  ${snapshot.shell.keyboard.join(' · ')}`);
  lines.push('');
  lines.push(chalk.bold('Premium panels'));
  for (const panel of snapshot.panels) {
    lines.push(`  ${statusIcon(panel.status)} [${panel.hotkey}] ${panel.label.padEnd(21)} ${panel.summary}`);
  }
  lines.push('');
  lines.push(chalk.bold('Primary actions'));
  for (const action of snapshot.actions) lines.push(`  • ${action}`);
  return lines.join('\n');
}

export function renderTuiPanel(snapshot: TuiDashboardSnapshot, panelId: TuiRouteId): string {
  const panel = snapshot.panels.find((item) => item.id === panelId) ?? snapshot.panels[0];
  const lines = [
    chalk.cyanBright.bold(`╭─ ${panel.label} ─────────────────────────────────────`),
    `│ status ${statusIcon(panel.status)} ${panel.status} · ${panel.summary}`,
    chalk.cyanBright('╰──────────────────────────────────────────────────────'),
    '',
    chalk.bold('Details'),
    ...panel.detail.map((item) => `  • ${item}`),
    '',
    chalk.bold('Available actions'),
    ...panel.actions.map((item) => `  → ${item}`),
  ];
  return lines.join('\n');
}

export async function runInteractiveTui(context: InteractiveTuiContext): Promise<void> {
  intro(chalk.cyanBright('Nova TUI · Premium Command Center'));
  note(renderTuiDashboardSnapshot(await buildInteractiveSnapshot(context.config)), 'Workspace overview');
  while (true) {
    const action = await select({
      message: 'Navigate Nova Command Center',
      options: [
        { value: 'dashboard', label: '[d] Dashboard', hint: 'full shell snapshot, keyboard map, readiness, safety' },
        { value: 'run', label: '[r] Prompt streaming', hint: 'stream live output, persist session/run metadata' },
        { value: 'sessions', label: '[s] Sessions & runs', hint: 'create/select/current/replay metadata' },
        { value: 'config', label: '[c] Onboarding/config', hint: 'init/validate/readiness without secrets' },
        { value: 'providers', label: '[p] Providers & models', hint: 'selectable profiles and doctor' },
        { value: 'profiles', label: '[a] Agent profiles', hint: 'builder/qa/security metadata' },
        { value: 'logs', label: '[l] Logs & replay', hint: 'TUI snapshots from event logs' },
        { value: 'diagnostics', label: '[g] Diagnostics/readiness', hint: 'publish readiness and guardrails' },
        { value: 'approvals', label: '[v] Safety approvals', hint: 'review pending local approval metadata' },
        { value: 'exit', label: '[q] Exit' },
      ],
    });
    if (isCancel(action) || action === 'exit') {
      cancel('Nova TUI closed.');
      return;
    }
    if (action === 'dashboard') note(renderTuiDashboardSnapshot(await buildInteractiveSnapshot(context.config)), 'Dashboard');
    if (action === 'run') await runPromptFlow(context);
    if (action === 'sessions') await sessionsFlow(context.config);
    if (action === 'config') await configFlow(context.config);
    if (action === 'providers') await providersFlow(context.config);
    if (action === 'profiles') await profilesFlow(context.config);
    if (action === 'logs') await logsFlow(context.config);
    if (action === 'diagnostics') await diagnosticsFlow(context.config);
    if (action === 'approvals') await approvalsFlow(context.config);
  }
}

function buildPanels(snapshot: Omit<TuiDashboardSnapshot, 'panels'>): TuiPanelState[] {
  return PANEL_ORDER.map(({ id, label, hotkey }) => {
    if (id === 'dashboard') return panel(id, label, hotkey, snapshot.readiness.ready ? 'ready' : 'warning', 'workspace command surface unified', [
      `config=${snapshot.config.ok ? 'valid' : 'invalid'} provider=${snapshot.provider.ok ? 'ok' : 'blocked'} readiness=${snapshot.readiness.ready ? 'ready' : 'blocked'}`,
      `keyboard=${snapshot.shell.keyboard.join(' | ')}`,
      'non-interactive dashboard is deterministic for CI and smoke tests',
    ], ['open any panel by hotkey', 'run nova tui dashboard for automation']);
    if (id === 'run') return panel(id, label, hotkey, snapshot.provider.apiKeyStatus === 'present' ? 'ready' : 'blocked', snapshot.provider.apiKeyStatus === 'present' ? 'live prompt available with explicit user action' : 'LLM_API_KEY missing; live prompt blocked', [
      'streaming renderer is used for live agent output',
      'session metadata is enabled for runs launched from the TUI',
      'redacted event log persistence is optional per run',
      'TUI never asks for or stores API keys',
    ], ['enter prompt', 'choose redacted event log yes/no', 'review run summary']);
    if (id === 'sessions') return panel(id, label, hotkey, snapshot.session.sessionCount ? 'ready' : 'idle', `${snapshot.session.sessionCount} sessions · ${snapshot.session.runCount} runs`, [
      `current session=${snapshot.session.currentSessionId ?? 'none'}`,
      `current run=${snapshot.session.currentRunId ?? 'none'}`,
      `latest run status=${snapshot.session.latestRunStatus ?? 'none'}`,
      'current pointer is metadata-only: no raw prompt/tool input included',
    ], ['show current pointer', 'list sessions/runs', 'create and select session', 'select existing session']);
    if (id === 'config') return panel(id, label, hotkey, snapshot.config.ok ? 'ready' : 'blocked', snapshot.config.present ? 'project config present' : 'safe init available', [
      `path=${shortPath(snapshot.config.path)}`,
      `present=${snapshot.config.present} valid=${snapshot.config.ok} errors=${snapshot.config.errors}`,
      'safe config template excludes secrets; keys stay in environment variables',
    ], ['show config status', 'initialize safe config', 'force re-initialize after confirmation']);
    if (id === 'providers') return panel(id, label, hotkey, snapshot.provider.ok ? 'ready' : 'blocked', `${snapshot.provider.provider}/${snapshot.provider.model}`, [
      `profile=${snapshot.provider.id} protocol=${snapshot.provider.protocol}`,
      `api key status=${snapshot.provider.apiKeyStatus}; value is never displayed`,
      `fallback explicit=${snapshot.provider.fallbackEnabled}`,
    ], ['run provider doctor', 'browse built-in provider profiles']);
    if (id === 'profiles') return panel(id, label, hotkey, 'ready', `${snapshot.profile.id} · ${snapshot.profile.mode}`, [
      `name=${snapshot.profile.name}`,
      `policy=${snapshot.profile.policyProfileId ?? 'default'}`,
      'built-in profile metadata is sanitized before display',
    ], ['browse built-in agent profiles', 'inspect sanitized metadata']);
    if (id === 'logs') return panel(id, label, hotkey, snapshot.streaming.logCount ? 'ready' : 'idle', `${snapshot.streaming.logCount} redacted event logs`, [
      `event logging default=${snapshot.streaming.eventLogEnabled ? 'enabled' : 'disabled'}`,
      `latest log=${snapshot.streaming.latestLogId ?? 'none'}`,
      'replay renderer reads redacted JSONL events only',
    ], ['select log to replay', 'use nova tui latest', 'use nova tui replay <logId>']);
    if (id === 'diagnostics') return panel(id, label, hotkey, snapshot.readiness.ready ? 'ready' : 'warning', `blockers=${snapshot.readiness.blockers} warnings=${snapshot.readiness.warnings}`, [
      `critical blockers=${snapshot.readiness.criticalBlockers}`,
      'publish/tag/release/live/autonomy remain out of scope without explicit GO',
      `publishReady=${snapshot.readiness.publishReady}`,
    ], ['show production readiness summary', 'review safety invariants']);
    return panel(id, label, hotkey, snapshot.session.pendingApprovalCount ? 'warning' : 'idle', `${snapshot.session.pendingApprovalCount} pending approvals`, [
      `total approvals=${snapshot.session.approvalCount}`,
      'approval list is local metadata; raw tool inputs are not exposed',
      'approve/deny remains an explicit user decision',
    ], ['list pending approvals', 'approve or deny selected approval with reason']);
  });
}

function panel(id: TuiRouteId, label: string, hotkey: string, status: TuiPanelState['status'], summary: string, detail: string[], actions: string[]): TuiPanelState {
  return { id, label, hotkey, status, summary, detail, actions };
}

async function buildInteractiveSnapshot(config: AgentConfig): Promise<TuiDashboardSnapshot> {
  const snapshot = await buildTuiDashboardSnapshot(config);
  return { ...snapshot, shell: { ...snapshot.shell, mode: 'interactive' } };
}

async function runPromptFlow(context: InteractiveTuiContext): Promise<void> {
  note(renderTuiPanel(await buildInteractiveSnapshot(context.config), 'run'), 'Prompt streaming panel');
  if (!context.config.llm.apiKey) {
    note('LLM_API_KEY is missing. Configure it in your shell environment; Nova TUI never asks for or stores API keys.', 'Cannot run live prompt');
    return;
  }
  const prompt = await text({ message: 'Prompt for Nova', placeholder: 'Ask Nova to inspect, plan, explain, or implement…', validate: (value) => value.trim() ? undefined : 'Prompt is required.' });
  if (isCancel(prompt)) return;
  const eventLog = await confirm({ message: 'Persist a redacted streaming event log for replay?', initialValue: true });
  if (isCancel(eventLog)) return;
  const spin = spinner();
  spin.start('Starting Nova run…');
  try {
    spin.stop('Streaming run started');
    const summary = await context.runPrompt(String(prompt), { eventLog: Boolean(eventLog) });
    if (summary) note([
      `status=${summary.status}`,
      `session=${summary.sessionId ?? 'none'} run=${summary.runId ?? 'none'}`,
      `tools=${summary.toolCallCount}`,
      summary.streamingEventLogPath ? `eventLog=${summary.streamingEventLogPath}` : 'eventLog=none',
    ].join('\n'), 'Run summary');
  } catch (err) {
    spin.stop('Run failed');
    note(redactString(err instanceof Error ? err.message : String(err), 1_000), 'Error');
  }
}

async function sessionsFlow(config: AgentConfig): Promise<void> {
  note(renderTuiPanel(await buildInteractiveSnapshot(config), 'sessions'), 'Sessions & runs panel');
  const sessionConfig = { ...config.session, enabled: true };
  const store = new SessionStore(sessionConfig);
  const currentStore = new CurrentSessionStore(sessionConfig);
  const action = await select({
    message: 'Sessions & runs',
    options: [
      { value: 'current', label: 'Show current pointer' },
      { value: 'list', label: 'List sessions/runs' },
      { value: 'create', label: 'Create and select session' },
      { value: 'select', label: 'Select existing session' },
      { value: 'back', label: 'Back' },
    ],
  });
  if (isCancel(action) || action === 'back') return;
  if (action === 'current') {
    note(formatCurrentPointer(await currentStore.get().catch(() => undefined)), 'Current session');
    return;
  }
  const sessions = await store.listSessions();
  const runs = await store.listRuns();
  if (action === 'list') {
    note([
      `sessions=${sessions.length}`,
      ...sessions.slice(0, 8).map((session) => `${session.id} · ${session.status} · ${session.title} · runs=${session.runIds.length}`),
      `runs=${runs.length}`,
      ...runs.slice(0, 8).map((run) => `${run.id} · ${run.status} · ${run.objective}`),
    ].join('\n'), 'Local session metadata');
    return;
  }
  if (action === 'create') {
    const title = await text({ message: 'Session title', placeholder: 'Nova project work', validate: (value) => value.trim() ? undefined : 'Title is required.' });
    if (isCancel(title)) return;
    const objective = await text({ message: 'Session objective', placeholder: 'What should this session optimize for?' });
    if (isCancel(objective)) return;
    const manager = new SessionRunManager(sessionConfig);
    const session = await manager.createSession({ title: String(title), objective: String(objective || ''), profileId: config.profile?.id, tags: ['tui'] });
    await currentStore.set({ sessionId: session.id, source: 'cli' });
    note(`${session.id}\n${session.title}`, 'Session created and selected');
    return;
  }
  if (action === 'select') {
    if (!sessions.length) { note('No sessions yet. Create one first or run an agent prompt with sessions enabled.', 'No sessions'); return; }
    const sessionId = await select({ message: 'Select session', options: sessions.slice(0, 20).map((session) => ({ value: session.id, label: session.title, hint: `${session.id} · ${session.status}` })) });
    if (isCancel(sessionId)) return;
    const session = await store.getSession(String(sessionId));
    await currentStore.set({ sessionId: String(sessionId), runId: session?.activeRunId, source: 'cli' });
    note(String(sessionId), 'Current session selected');
  }
}

async function configFlow(config: AgentConfig): Promise<void> {
  note(renderTuiPanel(await buildInteractiveSnapshot(config), 'config'), 'Onboarding/config panel');
  const project = readProjectConfig();
  const action = await select({
    message: 'Configuration',
    options: [
      { value: 'status', label: 'Show config status' },
      { value: 'init', label: project.present ? 'Re-initialize config with --force' : 'Initialize safe config' },
      { value: 'back', label: 'Back' },
    ],
  });
  if (isCancel(action) || action === 'back') return;
  if (action === 'status') {
    note([`path=${project.path}`, `present=${project.present}`, `ok=${project.ok}`, `errors=${project.errors.join('; ') || 'none'}`, 'secrets=never stored here; use environment variables'].join('\n'), 'Config status');
    return;
  }
  if (action === 'init') {
    const force = project.present ? await confirm({ message: 'Overwrite existing .nova/config.json with the safe template?', initialValue: false }) : true;
    if (isCancel(force) || !force) return;
    const initialized = initProjectConfig(process.cwd(), Boolean(force));
    note([`path=${initialized.path}`, `ok=${initialized.ok}`, `errors=${initialized.errors.join('; ') || 'none'}`].join('\n'), 'Config initialized');
  }
}

async function providersFlow(config: AgentConfig): Promise<void> {
  note(renderTuiPanel(await buildInteractiveSnapshot(config), 'providers'), 'Providers/models panel');
  const action = await select({
    message: 'Providers & models',
    options: [
      { value: 'doctor', label: 'Provider doctor' },
      { value: 'list', label: 'Browse built-in provider profiles' },
      { value: 'back', label: 'Back' },
    ],
  });
  if (isCancel(action) || action === 'back') return;
  if (action === 'doctor') {
    const project = readProjectConfig();
    const report = providerDoctor(resolveProviderRuntime({ project: project.config, env: process.env }), process.env);
    note(formatProviderDoctor(report), 'Provider doctor');
    return;
  }
  const profiles = listProviderProfiles();
  const id = await select({ message: 'Provider profile', options: profiles.slice(0, 30).map((profile) => ({ value: profile.id, label: profile.label, hint: `${profile.provider}/${profile.model}` })) });
  if (isCancel(id)) return;
  const profile = profiles.find((item) => item.id === id);
  note(profile ? [`id=${profile.id}`, `label=${profile.label}`, `provider=${profile.provider}`, `model=${profile.model}`, `protocol=${profile.protocol}`, `baseUrl=${profile.baseUrl}`, `apiKeyEnv=${profile.apiKeyEnv}`, `notes=${profile.notes ?? 'none'}`].join('\n') : 'Profile not found', 'Provider profile');
}

async function profilesFlow(config: AgentConfig): Promise<void> {
  note(renderTuiPanel(await buildInteractiveSnapshot(config), 'profiles'), 'Agent profiles panel');
  const profiles = builtInProfileCatalogue();
  const id = await select({ message: 'Agent profile', options: [...profiles.map((profile) => ({ value: profile.id, label: profile.name, hint: `${profile.id} · ${profile.defaultMode}` })), { value: 'back', label: 'Back' }] });
  if (isCancel(id) || id === 'back') return;
  const profile = profiles.find((item) => item.id === id);
  note(profile ? [`id=${profile.id}`, `version=${profile.version}`, `name=${profile.name}`, `mode=${profile.defaultMode}`, `policy=${profile.policyProfileId}`, `roles=${profile.compatibleRoles.join(',') || 'none'}`, `tags=${profile.tags.join(',') || 'none'}`, `objective=${profile.objective}`].join('\n') : 'Profile not found', 'Agent profile');
}

async function logsFlow(config: AgentConfig): Promise<void> {
  note(renderTuiPanel(await buildInteractiveSnapshot(config), 'logs'), 'Logs/replay panel');
  const store = new StreamingEventLogStore({ ...config.streaming?.eventLog, enabled: true });
  const logs = await store.list();
  if (!logs.length) { note('No streaming event logs found. Enable event logging for a run first.', 'Logs'); return; }
  const logId = await select({ message: 'Replay log', options: logs.slice(0, 20).map((log) => ({ value: log.logId, label: log.logId, hint: `${log.sizeBytes} bytes · ${log.updatedAt}` })) });
  if (isCancel(logId)) return;
  const events = await store.read(String(logId));
  note(new TuiReplayRenderer().render(events, { title: `Nova TUI replay · ${logId}` }), 'Replay');
}

async function diagnosticsFlow(config: AgentConfig): Promise<void> {
  const snapshot = await buildInteractiveSnapshot(config);
  const readiness = buildProductionReadinessReport();
  note([
    renderTuiPanel(snapshot, 'diagnostics'),
    '',
    `readiness.ready=${readiness.readiness.ready}`,
    `criticalBlockers=${readiness.readiness.criticalBlockedCount}`,
    `publishReady=${readiness.installableNow.npmPublishReady}`,
    'publish/tag/release/live/autonomy remain blocked without explicit GO.',
  ].join('\n'), 'Diagnostics');
}

async function approvalsFlow(config: AgentConfig): Promise<void> {
  note(renderTuiPanel(await buildInteractiveSnapshot(config), 'approvals'), 'Safety approvals panel');
  const manager = new ApprovalManager({ ...config.session, enabled: true });
  const approvals = await manager.list();
  if (!approvals.length) { note('No approval requests found in local run metadata.', 'Approvals'); return; }
  const action = await select({ message: 'Approvals', options: [
    { value: 'list', label: 'List approval metadata' },
    { value: 'decide', label: 'Approve/deny pending approval' },
    { value: 'back', label: 'Back' },
  ] });
  if (isCancel(action) || action === 'back') return;
  if (action === 'list') {
    note(approvals.slice(0, 12).map((approval) => `${approval.approvalId} · ${approval.status} · ${approval.capability}/${approval.action} · run=${approval.runId}`).join('\n'), 'Approval metadata');
    return;
  }
  const pending = approvals.filter((approval) => approval.status === 'pending');
  if (!pending.length) { note('No pending approvals to decide.', 'Approvals'); return; }
  const approvalId = await select({ message: 'Pending approval', options: pending.slice(0, 20).map((approval) => ({ value: approval.approvalId, label: `${approval.capability}: ${approval.action}`, hint: `${approval.approvalId} · ${approval.riskLevel ?? 'risk?'}` })) });
  if (isCancel(approvalId)) return;
  const decision = await select({ message: 'Decision', options: [{ value: 'denied', label: 'Deny', hint: 'safest default' }, { value: 'approved', label: 'Approve', hint: 'explicit local approval' }] });
  if (isCancel(decision)) return;
  const reason = await text({ message: 'Decision reason', placeholder: 'Why is this safe/blocked?' });
  if (isCancel(reason)) return;
  const result = await manager.decide({ approvalId: String(approvalId), decision: decision as 'approved' | 'denied', reason: String(reason || ''), decidedBy: 'tui' });
  note(`${result.approvalId} · ${result.status} · ${result.decisionReason ?? ''}`, 'Approval decided');
}

function statusIcon(status: TuiPanelState['status']): string {
  if (status === 'ready') return chalk.green('●');
  if (status === 'warning') return chalk.yellow('●');
  if (status === 'blocked') return chalk.red('●');
  return chalk.gray('○');
}

function badge(ok: boolean, yes: string, no: string): string {
  return ok ? chalk.green(`✓ ${yes}`) : chalk.red(`✖ ${no}`);
}

function shortPath(value: string): string {
  return value.replace(process.cwd(), '.');
}

function formatCurrentPointer(pointer: Awaited<ReturnType<CurrentSessionStore['get']>>): string {
  if (!pointer) return 'No current session set.';
  return [`sessionId=${pointer.sessionId}`, `runId=${pointer.runId ?? 'none'}`, `source=${pointer.source}`, `metadataOnly=${pointer.safety.metadataOnly}`, `secretsIncluded=${pointer.safety.secretsIncluded}`, `rawPromptsIncluded=${pointer.safety.rawPromptsIncluded}`, `rawToolInputsIncluded=${pointer.safety.rawToolInputsIncluded}`].join('\n');
}

function formatProviderDoctor(report: ReturnType<typeof providerDoctor>): string {
  return [
    `ok=${report.ok}`,
    `profile=${report.primary.id}`,
    `provider=${report.primary.provider}`,
    `model=${report.primary.model}`,
    `protocol=${report.primary.protocol}`,
    `baseUrl=${report.primary.baseUrl}`,
    `apiKeyStatus=${report.apiKey.status}`,
    `fallbackEnabled=${report.fallback.enabled}`,
    `warnings=${report.warnings.join('; ') || 'none'}`,
    `errors=${report.errors.join('; ') || 'none'}`,
  ].join('\n');
}
