export type CliHelpTopic = 'global' | 'batch' | 'tui' | 'streaming' | 'config' | 'sessions' | 'runs' | 'approvals' | 'conversations';

export const cliHelpTopics: CliHelpTopic[] = ['batch', 'tui', 'streaming', 'config', 'sessions', 'runs', 'approvals', 'conversations'];

const knownFlagsWithValues = new Set(['profile', 'stream-mode', 'thinking', 'report', 'limit', 'only', 'from', 'mode']);
const knownBooleanFlags = new Set([
  'help', 'h',
  'stream', 'no-stream', 'stream-compact', 'stream-verbose', 'no-stream-metrics', 'no-stream-tools',
  'event-log', 'continue-on-error', 'dry-run', 'compact', 'verbose',
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
  return [
    'Nova Agent — CLI',
    '',
    section('Usage', [
      ['nova "<prompt>"', 'Run one prompt (requires LLM_API_KEY).'],
      ['nova', 'Start interactive mode (requires LLM_API_KEY).'],
      ['nova help [topic]', 'Show help without invoking LLM/tools.'],
      ['nova <topic> --help', 'Show domain help without invoking LLM/tools.'],
    ]),
    '',
    section('Topics', [
      ['batch', 'Sequential non-interactive prompt files with JSON reports.'],
      ['tui', 'Terminal UI prototype for event-log replay.'],
      ['streaming', 'Live output, event logs, replay.'],
      ['config', 'Project config show/init/validate/explain.'],
      ['sessions', 'List/show/current/use local sessions.'],
      ['runs', 'List/show/replay/report/resume runs.'],
      ['approvals', 'List/approve/deny approval requests.'],
      ['conversations', 'Show/summary/compact stored conversations.'],
    ]),
    '',
    section('Main flags', [
      ['--profile <id>', 'Use an agent profile, e.g. nova.builder.'],
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

export function renderHelp(topic: CliHelpTopic = 'global'): string {
  switch (topic) {
    case 'batch': return batchHelp();
    case 'tui': return tuiHelp();
    case 'streaming': return streamingHelp();
    case 'config': return configHelp();
    case 'sessions': return sessionsHelp();
    case 'runs': return runsHelp();
    case 'approvals': return approvalsHelp();
    case 'conversations': return conversationsHelp();
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
