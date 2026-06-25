import { readNovaPackageInfo } from './version.js';

export type CliHelpTopic = 'global' | 'batch' | 'tui' | 'streaming' | 'providers' | 'profiles' | 'config' | 'sessions' | 'runs' | 'approvals' | 'conversations' | 'heartbeat' | 'eval' | 'memory' | 'subagents' | 'tokens';

export const cliHelpTopics: CliHelpTopic[] = ['batch', 'tui', 'streaming', 'providers', 'profiles', 'config', 'sessions', 'runs', 'approvals', 'conversations', 'heartbeat', 'eval', 'memory', 'subagents', 'tokens'];

const knownFlagsWithValues = new Set(['profile', 'provider-profile', 'provider-fallback', 'stream-mode', 'thinking', 'report', 'report-md', 'limit', 'only', 'from', 'mode', 'out', 'md', 'now', 'horizon', 'max', 'target', 'every', 'at', 'title', 'summary', 'body', 'tags', 'collection', 'type', 'scope', 'project', 'confidence', 'importance', 'budget', 'reason']);
const knownBooleanFlags = new Set([
  'help', 'h',
  'version', 'v',
  'stream', 'no-stream', 'stream-compact', 'stream-verbose', 'no-stream-metrics', 'no-stream-tools',
  'event-log', 'continue-on-error', 'dry-run', 'ci', 'compact', 'verbose', 'json', 'markdown', 'stdout',
]);

function section(title: string, rows: Array<[string, string]>): string {
  const width = Math.max(...rows.map(([left]) => left.length), 0);
  return [title, ...rows.map(([left, right]) => `  ${left.padEnd(width)}  ${right}`)].join('\n');
}

function normalizeTopic(value: string | undefined): CliHelpTopic | undefined {
  if (!value) return 'global';
  const normalized = value.toLowerCase();
  if (normalized === 'session') return 'sessions';
  if (normalized === 'run') return 'runs';
  if (normalized === 'approval') return 'approvals';
  if (normalized === 'conversation') return 'conversations';
  if (normalized === 'stream') return 'streaming';
  if (normalized === 'terminal-ui') return 'tui';
  if (normalized === 'global' || cliHelpTopics.includes(normalized as CliHelpTopic)) return normalized as CliHelpTopic;
  return undefined;
}

export function isKnownCliTopic(value: string | undefined): boolean {
  return normalizeTopic(value) !== undefined && normalizeTopic(value) !== 'global';
}

export function helpTopicFromArgs(args: string[]): CliHelpTopic | undefined {
  const first = args[0];
  if (!first || first === '--help' || first === '-h') return first ? 'global' : undefined;
  if (first === 'help') return args[1] ? normalizeTopic(args[1]) : 'global';
  if (args.includes('--help') || args.includes('-h') || args[1] === 'help') return normalizeTopic(first) ?? 'global';
  return undefined;
}

export function isKnownGlobalFlag(arg: string): boolean {
  if (!arg.startsWith('--')) return true;
  const name = arg.slice(2).split('=')[0] ?? '';
  return knownBooleanFlags.has(name) || knownFlagsWithValues.has(name);
}

function globalHelp(): string {
  const packageInfo = readNovaPackageInfo();
  return [
    `Nova Agent — CLI v${packageInfo.version}`,
    '',
    section('Usage', [
      ['nova "<prompt>"', 'Run one prompt (requires LLM_API_KEY).'],
      ['nova', 'Start interactive mode (requires LLM_API_KEY).'],
      ['nova --version', 'Print package version without invoking LLM/tools.'],
      ['nova version', 'Print package version without invoking LLM/tools.'],
      ['nova help [topic]', 'Show help without invoking LLM/tools.'],
      ['nova <topic> --help', 'Show domain help without invoking LLM/tools.'],
    ]),
    '',
    section('Topics', [
      ['batch', 'Sequential non-interactive prompt files with JSON/Markdown reports.'],
      ['tui', 'Terminal UI prototype for event-log replay.'],
      ['streaming', 'Live output, event logs, replay.'],
      ['providers', 'Provider/model profiles and safe diagnostics.'],
      ['profiles', 'Agent profile catalogue and safe validation diagnostics.'],
      ['config', 'Project config show/init/validate/explain.'],
      ['sessions', 'List/show/current/use local sessions.'],
      ['runs', 'List/show/replay/report/resume runs.'],
      ['approvals', 'List/approve/deny approval requests.'],
      ['conversations', 'Show/summary/compact stored conversations.'],
      ['heartbeat', 'Safe disabled-by-default planning ticks for autonomous-task metadata.'],
      ['eval', 'Read-only local eval report list/summary/compare commands.'],
      ['memory', 'Persistent local memory and RAG retrieval commands.'],
      ['subagents', 'Bounded sub-agent roles and metadata-only DAG planning.'],
      ['tokens', 'Local token estimation, cost and compaction diagnostics.'],
    ]),
    '',
    section('Main flags', [
      ['--version, -v', 'Print the package version from package.json.'],
      ['--profile <id>', 'Use an agent profile, e.g. nova.builder.'],
      ['--provider-profile <id>', 'Use a built-in provider/model profile.'],
      ['--provider-fallback <ids>', 'Opt-in fallback profile ids, comma-separated; never silent.'],
      ['--stream', 'Force streaming output.'],
      ['--no-stream', 'Force non-streaming generateText fallback.'],
      ['--stream-mode=<mode>', 'compact | normal | verbose.'],
      ['--stream-compact', 'Shortcut for --stream-mode=compact.'],
      ['--stream-verbose', 'Shortcut for --stream-mode=verbose.'],
      ['--thinking=<mode>', 'hidden | collapsed | expanded.'],
      ['--no-stream-metrics', 'Hide live tokens/timer/cost metrics.'],
      ['--no-stream-tools', 'Hide live tool events.'],
      ['--event-log', 'For batch: persist event logs for each item.'],
      ['--report <path>', 'For batch: write report JSON to a custom path.'],
      ['--report-md <path>', 'For batch: write a human-readable Markdown report.'],
      ['--ci', 'For batch: stable automation output and strict exit codes.'],
      ['--continue-on-error', 'For batch: keep running after an item error.'],
      ['--dry-run', 'For batch: validate and display selected items without LLM/tools.'],
      ['--limit N', 'For batch: select at most N executable items.'],
      ['--only id1,id2', 'For batch: select only listed item ids.'],
      ['--from id', 'For batch: resume selection starting at id.'],
    ]),
    '',
    section('Recommended local usage', [
      ['npx tsx src/index.ts --help', 'Run from the repository without installing the bin.'],
      ['npx tsx src/index.ts --stream "résume le projet"', 'One-shot streaming prompt.'],
      ['npm run start -- --help', 'With npm scripts, put CLI args after --.'],
    ]),
  ].join('\n');
}

function tuiHelp(): string {
  return [
    'Nova CLI help — tui',
    '',
    section('Commands', [
      ['nova tui replay <logId>', 'Render a terminal UI snapshot from a saved streaming event log.'],
      ['nova tui latest', 'Replay the most recently updated event log.'],
      ['nova streaming logs', 'List available log IDs.'],
    ]),
    '',
    section('Options', [
      ['--compact', 'Header + final/error only.'],
      ['--verbose', 'Fuller timeline and longer previews.'],
      ['--mode compact|normal|verbose', 'Explicit render mode.'],
    ]),
    '',
    'TUI V0.1 is read-only and reuses existing RuntimeStreamingEvent JSONL logs. It does not start a daemon, web dashboard, scheduler, or new persistence layer.',
  ].join('\n');
}

function batchHelp(): string {
  return [
    'Nova CLI help — batch',
    '',
    section('Commands', [
      ['nova batch <file>', 'Run prompts sequentially from .txt or .json.'],
      ['nova batch prompts.txt --stream', 'Stream each item while still writing a report.'],
      ['nova batch prompts.json --event-log', 'Persist redacted per-item event logs.'],
      ['nova batch prompts.json --report .nova/batch/report.json', 'Write report to a custom path.'],
      ['nova batch prompts.json --report-md .nova/batch/report.md', 'Write a human-readable Markdown report.'],
      ['nova batch prompts.json --ci', 'Print stable automation-friendly lines and strict exit codes.'],
      ['nova batch prompts.json --dry-run', 'Validate and display selected items without LLM/tools/API key.'],
    ]),
    '',
    section('Formats', [
      ['.txt', 'One prompt per line; empty lines, # comments and // comments ignored.'],
      ['.json', 'Array of objects: [{ "id": "task-1", "prompt": "..." }].'],
    ]),
    '',
    section('Options', [
      ['--stream', 'Use streaming output for each item.'],
      ['--event-log', 'Enable redacted JSONL event logs for each item.'],
      ['--report <path>', 'Write the structured JSON report at this path.'],
      ['--report-md <path>', 'Write a readable Markdown report with summary, item table, errors/details and run/event-log references.'],
      ['--ci', 'Use stable BATCH_* console lines; exit non-zero if the batch is not completed.'],
      ['--continue-on-error', 'Continue after item errors; default is stop and mark remaining skipped.'],
      ['--dry-run', 'Validate input and filters, write report, do not execute LLM/tools.'],
      ['--limit N', 'Select at most N executable items.'],
      ['--only id1,id2', 'Select only the listed item ids.'],
      ['--from id', 'Resume selection starting at item id.'],
    ]),
    '',
    'Batch V1 is sequential: no scheduler, daemon, TUI, parallelism, or extra batch-level retry loop.',
  ].join('\n');
}

function streamingHelp(): string {
  return [
    'Nova CLI help — streaming',
    '',
    section('Commands', [
      ['nova --stream "<prompt>"', 'Run a prompt with live streaming output.'],
      ['nova streaming logs', 'List redacted JSONL event logs.'],
      ['nova streaming show <logId>', 'Print one event log as JSON.'],
      ['nova streaming replay <logId>', 'Replay saved events to the CLI renderer; no LLM/tools.'],
    ]),
    '',
    section('Streaming flags', [
      ['--stream / --no-stream', 'Force streaming on/off.'],
      ['--stream-mode=compact|normal|verbose', 'Select live renderer detail level.'],
      ['--stream-compact / --stream-verbose', 'Mode shortcuts.'],
      ['--thinking=hidden|collapsed|expanded', 'Control safe reasoning/thinking display.'],
      ['--no-stream-metrics', 'Hide timer/tokens/cost estimates.'],
      ['--no-stream-tools', 'Hide tool call/result events.'],
    ]),
    '',
    section('Environment / config', [
      ['NOVA_STREAMING=true', 'Enable streaming by default.'],
      ['NOVA_STREAMING_MODE=normal', 'Default compact|normal|verbose mode.'],
      ['NOVA_STREAMING_THINKING_MODE=collapsed', 'Default thinking display mode.'],
      ['NOVA_STREAMING_EVENT_LOG=true', 'Persist redacted event logs under .nova.'],
    ]),
  ].join('\n');
}

function configHelp(): string {
  return [
    'Nova CLI help — config',
    '',
    section('Commands', [
      ['nova config show', 'Show project config plus sanitized runtime config.'],
      ['nova config init [--force]', 'Create .nova/config.json from a safe template.'],
      ['nova config validate', 'Validate .nova/config.json without requiring LLM_API_KEY.'],
      ['nova config explain', 'Explain config precedence and safety rules.'],
    ]),
    '',
    section('Precedence', [
      ['CLI explicit flags', 'Highest priority, e.g. --profile or --stream.'],
      ['Environment variables', 'LLM_PROVIDER, LLM_MODEL, NOVA_STREAMING, etc.'],
      ['.nova/config.json', 'Safe project/runtime defaults; never secrets.'],
      ['Built-in defaults', 'Fallback provider/model/runtime defaults.'],
    ]),
    '',
    'Do not put API keys or secret-like values in .nova/config.json.',
  ].join('\n');
}

function providersHelp(): string {
  return [
    'Nova CLI help — providers',
    '',
    section('Commands', [
      ['nova providers list', 'List built-in provider/model profiles.'],
      ['nova providers show <id>', 'Show one profile without secrets.'],
      ['nova providers doctor', 'Validate selected provider/baseUrl/model/API key presence.'],
    ]),
    '',
    section('Selection', [
      ['--provider-profile <id>', 'Highest priority explicit provider profile.'],
      ['NOVA_PROVIDER_PROFILE', 'Env provider profile default.'],
      ['.nova/config.json llm.providerProfile', 'Project provider profile default.'],
      ['LLM_PROVIDER/BASE_URL/MODEL', 'Explicit env overrides for adapter/base URL/model.'],
    ]),
    '',
    'Fallback is opt-in only via --provider-fallback, NOVA_PROVIDER_FALLBACK/NOVA_LLM_FALLBACK or llm.fallbackProfiles. Nova does not perform hidden automatic provider/model switching.',
  ].join('\n');
}

function profilesHelp(): string {
  return [
    'Nova CLI help — profiles',
    '',
    section('Commands', [
      ['nova profiles list', 'List built-in agent profiles as sanitized metadata.'],
      ['nova profiles show <id>', 'Show one sanitized profile metadata record.'],
      ['nova profiles doctor [id]', 'Validate all profiles or one profile for schema, policy and safe tool posture.'],
    ]),
    '',
    section('Safety checks', [
      ['schema/policy', 'Profile schema validates and referenced policy profile exists.'],
      ['secrets', 'Secret-like material is detected and reported without printing values.'],
      ['tools', 'Effective tools must not include write_file or bash/shell/exec by default.'],
    ]),
    '',
    'Profiles commands are metadata-only and do not invoke LLM/tools or read secrets.',
  ].join('\n');
}

function sessionsHelp(): string {
  return [
    'Nova CLI help — sessions',
    '',
    section('Commands', [
      ['nova sessions list', 'List local session metadata.'],
      ['nova sessions show <sessionId>', 'Show one session metadata record.'],
      ['nova sessions current', 'Show the metadata-only current pointer.'],
      ['nova sessions use <sessionId>', 'Set the current session pointer.'],
      ['nova sessions unset-current', 'Clear the current session pointer.'],
    ]),
    '',
    'Session commands are local/runtime metadata commands and do not invoke the LLM.',
  ].join('\n');
}

function runsHelp(): string {
  return [
    'Nova CLI help — runs',
    '',
    section('Commands', [
      ['nova runs list [sessionId]', 'List runs, optionally for one session.'],
      ['nova runs show <sessionId> <runId>', 'Show one run metadata record.'],
      ['nova runs current', 'Show the current run via the current session pointer.'],
      ['nova runs replay <sessionId> <runId>', 'Print metadata-only run timeline/report.'],
      ['nova runs report <sessionId> <runId>', 'Alias for replay.'],
      ['nova runs report-current', 'Replay/report the current run.'],
      ['nova runs resume <sessionId> <runId> [reason]', 'Create a planned child continuation run; no tool replay.'],
      ['nova runs resume-current [reason]', 'Resume from the current run pointer.'],
    ]),
    '',
    'Replay/resume commands do not re-execute tools or approved risky actions.',
  ].join('\n');
}

function approvalsHelp(): string {
  return [
    'Nova CLI help — approvals',
    '',
    section('Commands', [
      ['nova approvals list', 'List pending approval requests.'],
      ['nova approvals approve <approvalId> [reason]', 'Approve one stored request.'],
      ['nova approvals deny <approvalId> [reason]', 'Deny one stored request.'],
    ]),
    '',
    'Approvals only update stored decisions; they do not auto-run tools.',
  ].join('\n');
}

function conversationsHelp(): string {
  return [
    'Nova CLI help — conversations',
    '',
    section('Commands', [
      ['nova conversations show [sessionId]', 'Show redacted conversation turns; defaults to current session.'],
      ['nova conversations summary [sessionId]', 'Show deterministic stored summary.'],
      ['nova conversations compact [sessionId]', 'Compact conversation metadata without LLM.'],
    ]),
    '',
    'Conversation commands read/compact local redacted state and do not require LLM_API_KEY.',
  ].join('\n');
}

function heartbeatHelp(): string {
  return [
    'Nova CLI help — heartbeat',
    '',
    section('Commands', [
      ['nova heartbeat validate', 'Validate .nova/config.json heartbeat settings without LLM/tools/secrets.'],
      ['nova heartbeat status', 'Show local heartbeat state and report paths.'],
      ['nova heartbeat tasks', 'Classify configured tasks as due/skipped/blocked/needs_user_action.'],
      ['nova heartbeat approvals', 'Show the read-only cross-tick approval ledger from .nova/heartbeat/state.json (never decides).'],
      ['nova heartbeat decide <taskId> (--approve|--deny|--review) [--reason <text>]', 'Human-only, run-scoped decision surface for one pending heartbeat approval.'],
      ['nova heartbeat tick --dry-run', 'Run one planning-only tick and write JSON + Markdown reports under .nova/heartbeat.'],
      ['nova heartbeat plan', 'Project upcoming dry-run occurrences read-only and write a redacted plan under .nova/heartbeat/plans.'],
      ['nova heartbeat automation export', 'Write an inert (installed=false) operator manifest that only runs nova heartbeat tick --dry-run.'],
      ['nova heartbeat report latest', 'Print the latest heartbeat tick report, or exit 1 with guidance if none exists.'],
    ]),
    '',
    section('plan options', [
      ['--now <iso>', 'Project from a fixed ISO instant for deterministic output (default: current time).'],
      ['--horizon <dur>', 'Projection window, e.g. 90m, 6h, 7d (default: 6h).'],
      ['--max <n>', 'Cap occurrences projected per task (default: 50).'],
      ['--json', 'Print the full redacted plan report as JSON.'],
    ]),
    '',
    section('automation export options', [
      ['--target <kind>', 'windows-task | systemd | cron (required).'],
      ['--every <dur>', 'Run cadence, e.g. 15m, 1h (mutually exclusive with --at).'],
      ['--at <HH:MM>', 'Daily run time in 24-hour clock (mutually exclusive with --every).'],
      ['--stdout', 'Print the manifest to stdout instead of writing a file.'],
      ['--out <relpath>', 'Write under .nova/heartbeat/automation/<relpath>; paths escaping the sandbox are rejected.'],
      ['--json', 'Print the manifest metadata as JSON.'],
    ]),
    '',
    'Heartbeat is disabled by default and never starts a daemon, scheduler, LLM call, tool call, or autonomous write/shell/git/network/memory action.',
    'plan is a read-only projection over local state; automation export writes inert manifests only under .nova/heartbeat/automation. Nova does not schedule itself.',
  ].join('\n');
}

function evalHelp(): string {
  return [
    'Nova CLI help — eval reports',
    '',
    section('Commands', [
      ['nova eval list [--limit N] [--json]', 'List local .nova/evals/*/report.json runs, latest first.'],
      ['nova eval report latest|<evalRunId> [--json]', 'Show a safe report summary without finalAnswer/check actual.'],
      ['nova eval summary latest|<evalRunId> [--markdown]', 'Print a safe Markdown summary.'],
      ['nova eval summary <evalRunId> --out <path>', 'Write the Markdown summary outside .nova/evals.'],
      ['nova eval compare <previousRunId> <currentRunId> [--json|--markdown]', 'Compare pass rate, failed scenarios, gates and deltas.'],
      ['nova eval dashboard|slo latest|<evalRunId> [--json] [--previous <evalRunId>]', 'Show SLO readiness, gates, tool-call budgets and regressions.'],
    ]),
    '',
    'Eval report commands are read-only for existing eval runs: they only read structured .nova/evals/*/report.json artifacts, never report.md, traces, prompts, .env or secrets. They do not require LLM_API_KEY and do not instantiate NovaAgent or tools.',
    '',
    'Live/mock eval execution remains available through npm run eval or src/eval/runner.ts; this CLI topic is only for report/trend reading.',
  ].join('\n');
}

function memoryHelp(): string {
  return [
    'Nova CLI help — memory',
    '',
    section('Commands', [
      ['nova memory list', 'List memory index metadata and collections.'],
      ['nova memory show <id>', 'Show one memory item with large body omitted.'],
      ['nova memory add --title <t> --summary <s>', 'Persist a sanitized memory through policy/redaction/duplicate gates.'],
      ['nova memory search <query>', 'Retrieve ranked memory cards with local RAG scoring.'],
      ['nova memory retrieve <query>', 'Print the untrusted memory context block for a query.'],
      ['nova memory rag status', 'Show local RAG index metadata.'],
      ['nova memory rag rebuild', 'Rebuild the local deterministic RAG index.'],
      ['nova memory rag search <query>', 'Search local memory chunks with deterministic BM25-like scoring.'],
      ['nova memory rebuild-index', 'Rebuild the metadata index from item files.'],
      ['nova memory doctor', 'Validate item hashes and rebuild indexes safely.'],
    ]),
    '',
    'Memory commands are local-only. They reject secrets/raw .nova/.env artifacts, apply policy gates, and never invoke the LLM.',
  ].join('\n');
}

function subagentsHelp(): string {
  return [
    'Nova CLI help — subagents',
    '',
    section('Commands', [
      ['nova subagents roles', 'List bounded sub-agent roles, values, profiles and default grants.'],
      ['nova subagents plan <tasks.json>', 'Validate a task DAG and print metadata-only batches; no workers run.'],
    ]),
    '',
    section('Input format', [
      ['tasks array', '[{ "id": "research", "role": "researcher", "kind": "research", "prompt": "..." }]'],
      ['verification', 'Producer roles builder/docs/refactor require a dependent reviewer/qa/security gate.'],
      ['parallelism', 'Only independent read-only, non-overlapping scopes are marked parallelizable.'],
    ]),
    '',
    'Subagents CLI V1.1 is metadata-only: it does not spawn workers, invoke LLM/tools, grant write/shell/MCP, or allow recursive delegation.',
  ].join('\n');
}

function tokensHelp(): string {
  return [
    'Nova CLI help — tokens',
    '',
    section('Commands', [
      ['nova tokens estimate <text>', 'Estimate prompt tokens locally and optional cost from pricing env.'],
      ['nova tokens compact <text> --budget N', 'Deterministically compact text to a token budget.'],
      ['nova tokens doctor', 'Run local estimator/pricing/compaction diagnostics.'],
    ]),
    '',
    section('Pricing env', [
      ['LLM_INPUT_COST_PER_1M_TOKENS', 'Optional input cost per 1M tokens.'],
      ['LLM_OUTPUT_COST_PER_1M_TOKENS', 'Optional output cost per 1M tokens.'],
      ['LLM_PRICING_CURRENCY', 'Currency code, default USD.'],
      ['LLM_PRICING_SOURCE', 'Human-readable pricing source.'],
    ]),
    '',
    'Token commands are local-only and deterministic. They do not invoke LLM/tools, read secrets, or write files.',
  ].join('\n');
}

export function renderHelp(topic: CliHelpTopic = 'global'): string {
  switch (topic) {
    case 'batch': return batchHelp();
    case 'tui': return tuiHelp();
    case 'streaming': return streamingHelp();
    case 'providers': return providersHelp();
    case 'profiles': return profilesHelp();
    case 'config': return configHelp();
    case 'sessions': return sessionsHelp();
    case 'runs': return runsHelp();
    case 'approvals': return approvalsHelp();
    case 'conversations': return conversationsHelp();
    case 'heartbeat': return heartbeatHelp();
    case 'eval': return evalHelp();
    case 'memory': return memoryHelp();
    case 'subagents': return subagentsHelp();
    case 'tokens': return tokensHelp();
    case 'global': return globalHelp();
  }
}

function distance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) dp[i]![0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[a.length]![b.length]!;
}

export function closestCliTopic(value: string | undefined): CliHelpTopic | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  let best: { topic: CliHelpTopic; distance: number } | undefined;
  for (const topic of cliHelpTopics) {
    const d = distance(normalized, topic);
    if (!best || d < best.distance) best = { topic, distance: d };
  }
  return best && best.distance <= 2 ? best.topic : undefined;
}

export function renderUnknownCommand(args: string[], domain?: CliHelpTopic): string {
  const command = args.join(' ') || '(empty)';
  const suggestedTopic = domain ?? closestCliTopic(args[0]);
  return [
    `Unknown Nova command: ${command}`,
    suggestedTopic ? `Did you mean: nova ${suggestedTopic} --help` : 'Run nova --help to see available commands.',
    '',
    renderHelp(suggestedTopic ?? 'global'),
  ].join('\n');
}

export function shouldTreatAsUnknownCommand(args: string[]): boolean {
  const first = args[0];
  if (!first) return false;
  if (first.startsWith('--')) return !isKnownGlobalFlag(first);
  if (first === 'help' || isKnownCliTopic(first)) return false;
  return closestCliTopic(first) !== undefined;
}
