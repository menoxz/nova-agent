export type AuditSurface = 'cli' | 'package-script' | 'built-in-tool' | 'category';

export type SafetyClassification =
  | 'pure-read-only'
  | 'read-only-with-metadata-writes'
  | 'read-only-sensitive'
  | 'mutating'
  | 'live-provider'
  | 'dangerous-blocked';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface SafetyFlags {
  filesystemWrites: 'none' | 'metadata-only' | 'user-requested' | 'mutating' | 'unknown';
  shell: boolean;
  git: boolean;
  network: boolean;
  provider: boolean;
  createsAgent: boolean;
  registersOrExecutesTools: boolean;
  secretsEnvRisk: boolean;
  rawNovaRisk: boolean;
  outsideRootRisk: boolean;
}

export interface SafetyMatrixEntry {
  id: string;
  surface: AuditSurface;
  label: string;
  commandOrTool: string;
  classification: SafetyClassification;
  riskLevel: RiskLevel;
  orchestratorReadOnlyCompatible: boolean;
  flags: SafetyFlags;
  sourceRefs: string[];
  rationale: string;
}

export interface PackageScriptCoverage {
  script: string;
  matrixId: string;
  coverage: 'exact' | 'composite' | 'pattern' | 'blocked-category';
  rationale: string;
}

const noRisk: SafetyFlags = {
  filesystemWrites: 'none',
  shell: false,
  git: false,
  network: false,
  provider: false,
  createsAgent: false,
  registersOrExecutesTools: false,
  secretsEnvRisk: false,
  rawNovaRisk: false,
  outsideRootRisk: false,
};

function entry(input: SafetyMatrixEntry): SafetyMatrixEntry {
  return input;
}

function safeCli(id: string, commandOrTool: string, rationale: string, refs: string[] = ['src/index.ts', 'src/cli/help.ts']): SafetyMatrixEntry {
  return entry({
    id,
    surface: 'cli',
    label: commandOrTool,
    commandOrTool,
    classification: 'pure-read-only',
    riskLevel: 'low',
    orchestratorReadOnlyCompatible: true,
    flags: { ...noRisk },
    sourceRefs: refs,
    rationale,
  });
}

function blockedCategory(id: string, label: string, rationale: string, flags: Partial<SafetyFlags>, refs: string[]): SafetyMatrixEntry {
  return entry({
    id,
    surface: 'category',
    label,
    commandOrTool: label,
    classification: 'dangerous-blocked',
    riskLevel: 'critical',
    orchestratorReadOnlyCompatible: false,
    flags: { ...noRisk, ...flags },
    sourceRefs: refs,
    rationale,
  });
}

export const readOnlySafetyMatrix: readonly SafetyMatrixEntry[] = [
  safeCli('cli.help', 'nova --help | nova help | nova <topic> --help', 'Static help text only; returns before config, dotenv, provider, agent, or tool setup.'),
  safeCli('cli.version', 'nova --version | nova -v | nova version', 'Prints package version and returns before runtime setup.', ['src/index.ts', 'src/cli/version.ts']),
  safeCli('cli.config.validate', 'nova config validate', 'Validates project config shape and prints metadata/errors; no provider call or tool execution.', ['src/index.ts', 'src/config/index.ts']),
  safeCli('cli.config.explain', 'nova config explain', 'Explains effective project config schema in static text; no provider call or tool execution.', ['src/index.ts', 'src/config/index.ts']),
  entry({
    id: 'cli.config.show',
    surface: 'cli',
    label: 'nova config show',
    commandOrTool: 'nova config show',
    classification: 'pure-read-only',
    riskLevel: 'low',
    orchestratorReadOnlyCompatible: true,
    flags: { ...noRisk, secretsEnvRisk: true },
    sourceRefs: ['src/index.ts', 'src/config/index.ts'],
    rationale: 'Shows sanitized runtime config; must keep secret/env values redacted and must not call providers or tools.',
  }),
  entry({
    id: 'cli.config.init',
    surface: 'cli',
    label: 'nova config init',
    commandOrTool: 'nova config init [--force]',
    classification: 'mutating',
    riskLevel: 'medium',
    orchestratorReadOnlyCompatible: false,
    flags: { ...noRisk, filesystemWrites: 'mutating' },
    sourceRefs: ['src/index.ts', 'src/config/project.ts'],
    rationale: 'Creates or overwrites local .nova/config.json; not compatible with orchestrator read-only mode.',
  }),
  safeCli('cli.providers.list', 'nova providers list', 'Lists static provider directory/profile metadata and ignores invalid project config.', ['src/index.ts', 'src/providers/index.ts', 'src/providers/smoke.ts']),
  safeCli('cli.providers.show', 'nova providers show <id>', 'Shows static provider/profile metadata only; planned providers are not claimed executable.', ['src/index.ts', 'src/providers/index.ts', 'src/providers/smoke.ts']),
  entry({
    id: 'cli.providers.doctor',
    surface: 'cli',
    label: 'nova providers doctor',
    commandOrTool: 'nova providers doctor',
    classification: 'pure-read-only',
    riskLevel: 'low',
    orchestratorReadOnlyCompatible: true,
    flags: { ...noRisk, secretsEnvRisk: true },
    sourceRefs: ['src/index.ts', 'src/providers/index.ts', 'src/providers/smoke.ts'],
    rationale: 'Loads dotenv and reports API-key presence/status without printing values; no live provider call.',
  }),
  entry({
    id: 'cli.providers.live-smoke.future',
    surface: 'cli',
    label: 'future provider live smoke',
    commandOrTool: 'nova providers live-smoke | provider/LLM live smoke',
    classification: 'live-provider',
    riskLevel: 'critical',
    orchestratorReadOnlyCompatible: false,
    flags: { ...noRisk, provider: true, network: true, createsAgent: true, registersOrExecutesTools: true, secretsEnvRisk: true },
    sourceRefs: ['docs/provider-live-smoke-readiness.md', 'src/providers/readiness.ts'],
    rationale: 'Provider live smoke is only a future authorization-gated concept; no live provider/LLM call is read-only compatible.',
  }),
  entry({
    id: 'cli.batch.dry-run',
    surface: 'cli',
    label: 'nova batch <file> --dry-run',
    commandOrTool: 'nova batch <file> --dry-run [--report path] [--report-md path]',
    classification: 'read-only-with-metadata-writes',
    riskLevel: 'medium',
    orchestratorReadOnlyCompatible: true,
    flags: { ...noRisk, filesystemWrites: 'metadata-only', secretsEnvRisk: true, outsideRootRisk: true },
    sourceRefs: ['src/index.ts', 'src/batch/runner.ts', 'src/batch/smoke.ts'],
    rationale: 'Validates batch input without LLM/tools; may write bounded local synthetic reports to approved paths when requested.',
  }),
  entry({
    id: 'cli.batch.live',
    surface: 'cli',
    label: 'nova batch <file> (without --dry-run)',
    commandOrTool: 'nova batch <file>',
    classification: 'live-provider',
    riskLevel: 'critical',
    orchestratorReadOnlyCompatible: false,
    flags: { ...noRisk, filesystemWrites: 'metadata-only', provider: true, createsAgent: true, registersOrExecutesTools: true, secretsEnvRisk: true },
    sourceRefs: ['src/index.ts', 'src/batch/runner.ts'],
    rationale: 'Executes prompts through NovaAgent and tools and requires LLM_API_KEY; never classify as read-only.',
  }),
  safeCli('cli.eval.list', 'nova eval list', 'Lists sanitized eval report summaries; no live eval runner/provider execution.', ['src/index.ts', 'src/eval/report_cli.ts', 'src/eval/reporting.ts']),
  safeCli('cli.eval.report', 'nova eval report latest|<id>', 'Reads a sanitized summary of existing eval report data only; raw checks/final answers remain excluded.', ['src/eval/report_cli.ts', 'src/eval/report_smoke.ts']),
  safeCli('cli.eval.dashboard', 'nova eval dashboard|slo latest|<id>', 'Builds a sanitized local SLO/regression dashboard from structured report.json summaries/comparisons only; no raw eval bodies, provider, tools, or dotenv.', ['src/eval/report_cli.ts', 'src/eval/slo.ts', 'src/eval/slo_smoke.ts']),
  entry({
    id: 'cli.eval.summary',
    surface: 'cli',
    label: 'nova eval summary latest|<id>',
    commandOrTool: 'nova eval summary latest|<id> [--out path]',
    classification: 'read-only-with-metadata-writes',
    riskLevel: 'medium',
    orchestratorReadOnlyCompatible: true,
    flags: { ...noRisk, filesystemWrites: 'user-requested', rawNovaRisk: true, outsideRootRisk: true },
    sourceRefs: ['src/eval/report_cli.ts', 'src/eval/reporting.ts', 'src/eval/report_smoke.ts'],
    rationale: 'Summarizes existing reports with redaction; optional --out writes Markdown outside protected raw eval report directories.',
  }),
  safeCli('cli.eval.compare', 'nova eval compare <previous> <current>', 'Compares sanitized eval summaries without invoking the eval runner or provider.', ['src/eval/report_cli.ts', 'src/eval/report_smoke.ts']),
  entry({
    id: 'cli.eval.runner',
    surface: 'cli',
    label: 'src/eval/runner.ts live/replay/default runner',
    commandOrTool: 'npm run eval | npm run eval:replay | tsx src/eval/runner.ts',
    classification: 'mutating',
    riskLevel: 'high',
    orchestratorReadOnlyCompatible: false,
    flags: { ...noRisk, filesystemWrites: 'metadata-only', createsAgent: true, registersOrExecutesTools: true, secretsEnvRisk: true },
    sourceRefs: ['src/eval/runner.ts', 'package.json'],
    rationale: 'Default/live/replay eval runner modes may use non-mock execution or replay raw artifacts; blocked separately from explicit --mode mock package scripts.',
  }),
  safeCli('cli.heartbeat.validate', 'nova heartbeat validate', 'Validates heartbeat config and rejects secret-like values; no task execution.', ['src/heartbeat/index.ts', 'src/heartbeat/smoke.ts']),
  safeCli('cli.heartbeat.status', 'nova heartbeat status', 'Reads heartbeat state metadata only; no daemon or autonomous execution.', ['src/heartbeat/index.ts', 'src/heartbeat/store.ts']),
  safeCli('cli.heartbeat.tasks', 'nova heartbeat tasks', 'Prints configured task classifications only; no task execution.', ['src/heartbeat/index.ts', 'src/heartbeat/config.ts']),
  entry({
    id: 'cli.heartbeat.tick.dry-run',
    surface: 'cli',
    label: 'nova heartbeat tick --dry-run',
    commandOrTool: 'nova heartbeat tick --dry-run',
    classification: 'read-only-with-metadata-writes',
    riskLevel: 'medium',
    orchestratorReadOnlyCompatible: true,
    flags: { ...noRisk, filesystemWrites: 'metadata-only', rawNovaRisk: false },
    sourceRefs: ['src/heartbeat/runner.ts', 'src/heartbeat/store.ts', 'src/heartbeat/smoke.ts'],
    rationale: 'Planning-only dry-run: no LLM/tools/autonomy, but writes metadata-only heartbeat state/report/lock files.',
  }),
  entry({
    id: 'cli.heartbeat.tick.live',
    surface: 'cli',
    label: 'nova heartbeat tick without --dry-run / autonomy',
    commandOrTool: 'nova heartbeat tick',
    classification: 'dangerous-blocked',
    riskLevel: 'critical',
    orchestratorReadOnlyCompatible: false,
    flags: { ...noRisk, filesystemWrites: 'mutating', provider: true, createsAgent: true, registersOrExecutesTools: true },
    sourceRefs: ['src/heartbeat/runner.ts', 'src/heartbeat/reporter.ts'],
    rationale: 'Heartbeat V2 is planning-only; non-dry-run/autonomous execution must remain blocked/not represented as read-only.',
  }),
  safeCli('cli.heartbeat.report', 'nova heartbeat report latest', 'Reads safe heartbeat report output with redaction; no autonomous task execution.', ['src/heartbeat/index.ts', 'src/heartbeat/smoke.ts']),
  safeCli('cli.sessions.list-show-current', 'nova sessions list|show|current', 'Reads local session metadata; may expose session metadata and must not be used for raw secret/artifact dumping.', ['src/index.ts', 'src/session/index.ts']),
  entry({
    id: 'cli.sessions.use-unset',
    surface: 'cli',
    label: 'nova sessions use|unset-current',
    commandOrTool: 'nova sessions use <id> | nova sessions unset-current',
    classification: 'mutating',
    riskLevel: 'medium',
    orchestratorReadOnlyCompatible: false,
    flags: { ...noRisk, filesystemWrites: 'metadata-only' },
    sourceRefs: ['src/index.ts', 'src/session/current.ts'],
    rationale: 'Changes current session state under local metadata storage.',
  }),
  safeCli('cli.runs.list-show-report', 'nova runs list|show|current|report|report-current|replay', 'Reads/replays run metadata only and does not re-execute tools or approved risky actions.', ['src/index.ts', 'src/session/replay.ts']),
  entry({
    id: 'cli.runs.resume',
    surface: 'cli',
    label: 'nova runs resume|resume-current',
    commandOrTool: 'nova runs resume <sessionId> <runId> [reason]',
    classification: 'mutating',
    riskLevel: 'medium',
    orchestratorReadOnlyCompatible: false,
    flags: { ...noRisk, filesystemWrites: 'metadata-only' },
    sourceRefs: ['src/index.ts', 'src/session/resume.ts'],
    rationale: 'Creates planned continuation run metadata; does not execute tools, but mutates local session state.',
  }),
  safeCli('cli.approvals.list', 'nova approvals list', 'Lists pending approval metadata only.', ['src/index.ts', 'src/approval/manager.ts']),
  entry({
    id: 'cli.approvals.decide',
    surface: 'cli',
    label: 'nova approvals approve|deny',
    commandOrTool: 'nova approvals approve|deny <approvalId>',
    classification: 'mutating',
    riskLevel: 'medium',
    orchestratorReadOnlyCompatible: false,
    flags: { ...noRisk, filesystemWrites: 'metadata-only' },
    sourceRefs: ['src/index.ts', 'src/approval/manager.ts'],
    rationale: 'Changes approval state; should not be considered orchestrator read-only even though it does not execute tools.',
  }),
  safeCli('cli.conversations.show-summary', 'nova conversations show|summary', 'Reads conversation metadata/summary only; no provider/tool execution.', ['src/index.ts', 'src/session/conversation.ts']),
  entry({
    id: 'cli.conversations.compact',
    surface: 'cli',
    label: 'nova conversations compact',
    commandOrTool: 'nova conversations compact [sessionId]',
    classification: 'mutating',
    riskLevel: 'medium',
    orchestratorReadOnlyCompatible: false,
    flags: { ...noRisk, filesystemWrites: 'metadata-only' },
    sourceRefs: ['src/index.ts', 'src/session/conversation.ts'],
    rationale: 'Compacts conversation storage and changes local metadata.',
  }),
  safeCli('cli.streaming.logs-show-replay', 'nova streaming logs|show|read|replay', 'Reads/replays sanitized streaming event logs only; no live LLM/tool execution.', ['src/index.ts', 'src/streaming/index.ts']),
  entry({
    id: 'cli.prompt-interactive',
    surface: 'cli',
    label: 'prompt or interactive mode',
    commandOrTool: 'nova "prompt" | nova',
    classification: 'live-provider',
    riskLevel: 'critical',
    orchestratorReadOnlyCompatible: false,
    flags: { ...noRisk, provider: true, createsAgent: true, registersOrExecutesTools: true, secretsEnvRisk: true },
    sourceRefs: ['src/index.ts', 'src/agent.ts'],
    rationale: 'Requires LLM_API_KEY, constructs NovaAgent, registers tools, and may execute model-selected tools.',
  }),

  entry({
    id: 'script.typecheck',
    surface: 'package-script',
    label: 'npm run typecheck',
    commandOrTool: 'tsc --noEmit',
    classification: 'pure-read-only',
    riskLevel: 'low',
    orchestratorReadOnlyCompatible: true,
    flags: { ...noRisk, shell: true },
    sourceRefs: ['package.json', 'tsconfig.json'],
    rationale: 'Local compiler check with no emit; no provider, network, git, or state write expected.',
  }),
  entry({
    id: 'script.check-fast',
    surface: 'package-script',
    label: 'npm run check:fast',
    commandOrTool: 'npm run check:fast',
    classification: 'read-only-with-metadata-writes',
    riskLevel: 'medium',
    orchestratorReadOnlyCompatible: true,
    flags: { ...noRisk, shell: true, filesystemWrites: 'metadata-only' },
    sourceRefs: ['package.json', 'src/*/smoke.ts'],
    rationale: 'Composes offline smoke checks; some smoke tests create temporary/report metadata but avoid live providers.',
  }),
  entry({
    id: 'script.check',
    surface: 'package-script',
    label: 'npm run check',
    commandOrTool: 'npm run check',
    classification: 'read-only-with-metadata-writes',
    riskLevel: 'medium',
    orchestratorReadOnlyCompatible: true,
    flags: { ...noRisk, shell: true, filesystemWrites: 'metadata-only', createsAgent: true, registersOrExecutesTools: true },
    sourceRefs: ['package.json', 'src/eval/runner.ts'],
    rationale: 'Longer offline validation suite includes mock eval runners that instantiate agents/tools and write reports; safe for CI, not pure read-only.',
  }),
  entry({
    id: 'script.dev-start',
    surface: 'package-script',
    label: 'npm run dev | npm start',
    commandOrTool: 'tsx src/index.ts',
    classification: 'live-provider',
    riskLevel: 'critical',
    orchestratorReadOnlyCompatible: false,
    flags: { ...noRisk, shell: true, provider: true, createsAgent: true, registersOrExecutesTools: true, secretsEnvRisk: true },
    sourceRefs: ['package.json', 'src/index.ts'],
    rationale: 'Starts interactive Nova runtime unless read-only args are supplied; may invoke LLM/tools.',
  }),
  entry({
    id: 'script.build-prepack',
    surface: 'package-script',
    label: 'npm run build | npm run prepack',
    commandOrTool: 'tsc',
    classification: 'mutating',
    riskLevel: 'medium',
    orchestratorReadOnlyCompatible: false,
    flags: { ...noRisk, shell: true, filesystemWrites: 'mutating' },
    sourceRefs: ['package.json', 'tsconfig.json'],
    rationale: 'Writes dist build outputs; not read-only.',
  }),
  entry({
    id: 'script.smokes.safe',
    surface: 'package-script',
    label: 'offline smoke/package validation scripts',
    commandOrTool: 'npm run mcp:smoke | lsp:smoke | llm:smoke | memory:smoke | context:smoke | tokens:smoke | session:smoke | replay:smoke | conversation:smoke | current:smoke | config:smoke | streaming:*smoke | cli:smoke | batch:smoke | heartbeat:smoke | tui:smoke | bin:smoke | providers:smoke | providers:readiness-smoke | approval:smoke | profiles:smoke | policy:smoke | subagents:smoke | eval:report-smoke | eval:slo-smoke | trace:summary*',
    classification: 'read-only-with-metadata-writes',
    riskLevel: 'medium',
    orchestratorReadOnlyCompatible: true,
    flags: { ...noRisk, shell: true, filesystemWrites: 'metadata-only', createsAgent: true, registersOrExecutesTools: true, secretsEnvRisk: true },
    sourceRefs: ['package.json', 'src/*/smoke.ts', 'src/mcp/smoke.ts', 'src/lsp/smoke.ts'],
    rationale: 'Synthetic local smoke/summary scripts run offline fixtures only. Some start local stdio servers or instantiate mock agents/tools, so they are orchestrator-validation-compatible but not pure-read-only.',
  }),
  entry({
    id: 'script.eval-mock',
    surface: 'package-script',
    label: 'npm run eval:* --mode mock package scripts',
    commandOrTool: 'npm run eval:smoke | eval:mock | eval:core | eval:mcp | eval:lsp | eval:policy | eval:profiles | eval:subagents | eval:memory | eval:context | eval:tokens | eval:session | eval:approval | eval:run-replay | eval:conversation | eval:current | eval:config | eval:streaming | eval:llm | eval:cli | eval:batch | eval:heartbeat | eval:tui | eval:release | eval:quality | eval:providers | eval:provider-readiness | eval:report | eval:slo',
    classification: 'mutating',
    riskLevel: 'high',
    orchestratorReadOnlyCompatible: false,
    flags: { ...noRisk, shell: true, filesystemWrites: 'metadata-only', createsAgent: true, registersOrExecutesTools: true },
    sourceRefs: ['package.json', 'src/eval/runner.ts'],
    rationale: 'Mock mode is offline but still runs the evaluator, creates agents/tools, and writes eval reports.',
  }),
  entry({
    id: 'script.pack-dry-run',
    surface: 'package-script',
    label: 'npm pack --dry-run --ignore-scripts',
    commandOrTool: 'npm pack --dry-run --ignore-scripts',
    classification: 'pure-read-only',
    riskLevel: 'low',
    orchestratorReadOnlyCompatible: true,
    flags: { ...noRisk, shell: true },
    sourceRefs: ['README.md', 'docs/packaging-install.md'],
    rationale: 'Local package manifest inspection only when --dry-run and --ignore-scripts are both present.',
  }),
  entry({
    id: 'script.publish-pack-live',
    surface: 'package-script',
    label: 'publish/pack/tag/push/PR external commands',
    commandOrTool: 'npm publish | npm pack | git tag | git push | gh pr create',
    classification: 'dangerous-blocked',
    riskLevel: 'critical',
    orchestratorReadOnlyCompatible: false,
    flags: { ...noRisk, shell: true, git: true, network: true, filesystemWrites: 'mutating', secretsEnvRisk: true },
    sourceRefs: ['README.md', 'package.json'],
    rationale: 'Release/network/git state-changing commands are explicitly out of scope for read-only audit.',
  }),

  entry({
    id: 'tool.read-file-family',
    surface: 'built-in-tool',
    label: 'read_file/glob/grep/list_directory/get_file_info',
    commandOrTool: 'read_file | glob | grep | list_directory | get_file_info',
    classification: 'read-only-sensitive',
    riskLevel: 'medium',
    orchestratorReadOnlyCompatible: true,
    flags: { ...noRisk, secretsEnvRisk: true, rawNovaRisk: true, outsideRootRisk: true },
    sourceRefs: ['src/tools/builtin/read_file.ts', 'src/tools/builtin/glob.ts', 'src/tools/builtin/grep.ts', 'src/tools/builtin/list_directory.ts', 'src/tools/builtin/get_file_info.ts', 'src/policy/path.ts'],
    rationale: 'Filesystem reads are read-only but can expose secrets/raw artifacts unless policy path/content guards deny sensitive targets.',
  }),
  entry({
    id: 'tool.write-file',
    surface: 'built-in-tool',
    label: 'write_file',
    commandOrTool: 'write_file',
    classification: 'mutating',
    riskLevel: 'critical',
    orchestratorReadOnlyCompatible: false,
    flags: { ...noRisk, filesystemWrites: 'mutating' },
    sourceRefs: ['src/tools/builtin/write_file.ts', 'src/index.ts'],
    rationale: 'Writes/appends files; only registered behind NOVA_ENABLE_WRITE_TOOLS and never compatible with read-only audit.',
  }),
  entry({
    id: 'tool.bash',
    surface: 'built-in-tool',
    label: 'bash',
    commandOrTool: 'bash',
    classification: 'dangerous-blocked',
    riskLevel: 'critical',
    orchestratorReadOnlyCompatible: false,
    flags: { ...noRisk, shell: true, network: true, filesystemWrites: 'unknown', secretsEnvRisk: true, outsideRootRisk: true },
    sourceRefs: ['src/tools/builtin/bash.ts', 'src/index.ts'],
    rationale: 'Arbitrary shell may mutate local/remote state; only registered behind NOVA_ENABLE_WRITE_TOOLS and must not be read-only.',
  }),
  entry({
    id: 'tool.git',
    surface: 'built-in-tool',
    label: 'git read-only tool',
    commandOrTool: 'git status|diff|log|branch|show|ls-files',
    classification: 'pure-read-only',
    riskLevel: 'low',
    orchestratorReadOnlyCompatible: true,
    flags: { ...noRisk, git: true },
    sourceRefs: ['src/tools/builtin/git.ts'],
    rationale: 'Tool exposes a strict allowlist of local read-only git commands and disables prompts/pagers/network/destructive operations.',
  }),
  entry({
    id: 'tool.goal-todo-skill',
    surface: 'built-in-tool',
    label: 'goal/todo/skill',
    commandOrTool: 'goal | todo | skill',
    classification: 'mutating',
    riskLevel: 'medium',
    orchestratorReadOnlyCompatible: false,
    flags: { ...noRisk, filesystemWrites: 'metadata-only' },
    sourceRefs: ['src/tools/builtin/goal.ts', 'src/tools/builtin/todo.ts', 'src/tools/builtin/skill.ts'],
    rationale: 'May have read/list actions, but the tools as registered also create/update local .nova state; not pure read-only as a category.',
  }),
  entry({
    id: 'tool.web-search',
    surface: 'built-in-tool',
    label: 'web_search',
    commandOrTool: 'web_search',
    classification: 'dangerous-blocked',
    riskLevel: 'high',
    orchestratorReadOnlyCompatible: false,
    flags: { ...noRisk, network: true },
    sourceRefs: ['src/tools/builtin/web_search.ts', 'src/policy/profiles.ts'],
    rationale: 'Network access is not local/offline/static and must not be included in read-only command audit.',
  }),

  blockedCategory('category.daemon-autonomy', 'daemon/autonomy/background execution', 'No daemon, scheduler, or autonomous live action is in V2 read-only scope.', { provider: true, createsAgent: true, registersOrExecutesTools: true, filesystemWrites: 'mutating' }, ['src/heartbeat/reporter.ts', 'docs/heartbeat.md']),
  blockedCategory('category.provider-live', 'provider/LLM live calls', 'Any provider/LLM prompt path requires credentials and may execute tools; never classify as read-only.', { provider: true, secretsEnvRisk: true, createsAgent: true, registersOrExecutesTools: true }, ['src/index.ts', 'src/agent.ts']),
  blockedCategory('category.release-network', 'publish/tag/push/PR/release network', 'Publishing, tagging, pushing, and PR creation mutate remote state and are explicitly out of scope.', { shell: true, git: true, network: true, secretsEnvRisk: true, filesystemWrites: 'mutating' }, ['README.md', 'docs/packaging-install.md']),
  blockedCategory('category.sensitive-artifacts', '.env/secrets/raw .nova/traces/evals/reports/outside-root', 'Sensitive artifacts and raw internal reports are denied for read-only orchestration and should only surface via sanitized summaries.', { secretsEnvRisk: true, rawNovaRisk: true, outsideRootRisk: true }, ['src/policy/path.ts', 'docs/policy/README.md']),
] as const;

export const packageScriptCoverage: readonly PackageScriptCoverage[] = [
  { script: 'build', matrixId: 'script.build-prepack', coverage: 'exact', rationale: 'tsc writes dist outputs.' },
  { script: 'prepack', matrixId: 'script.build-prepack', coverage: 'exact', rationale: 'prepack delegates to build.' },
  { script: 'check:fast', matrixId: 'script.check-fast', coverage: 'exact', rationale: 'composite offline smoke validation with metadata writes.' },
  { script: 'test:targeted-v1', matrixId: 'script.check-fast', coverage: 'composite', rationale: 'same class as check:fast: typecheck plus offline smoke validations.' },
  { script: 'check', matrixId: 'script.check', coverage: 'exact', rationale: 'long composite validation including mock eval runners.' },
  { script: 'dev', matrixId: 'script.dev-start', coverage: 'exact', rationale: 'starts interactive runtime path.' },
  { script: 'start', matrixId: 'script.dev-start', coverage: 'exact', rationale: 'starts interactive runtime path.' },
  { script: 'mcp:stdio', matrixId: 'tool.read-file-family', coverage: 'composite', rationale: 'registers default MCP read/search/git/doc/eval/trace read-only tools; write/bash tools remain absent by default.' },
  { script: 'mcp:smoke', matrixId: 'script.smokes.safe', coverage: 'exact', rationale: 'offline MCP smoke starts a local stdio server and verifies read-only policy guards.' },
  { script: 'lsp:stdio', matrixId: 'script.smokes.safe', coverage: 'composite', rationale: 'starts a local read-only LSP server surface with no workspace edit/shell command support.' },
  { script: 'lsp:smoke', matrixId: 'script.smokes.safe', coverage: 'exact', rationale: 'offline LSP smoke validates read-only commands and denials.' },
  { script: 'llm:smoke', matrixId: 'script.smokes.safe', coverage: 'exact', rationale: 'offline LLM robustness smoke classifies synthetic errors/retries only.' },
  { script: 'memory:smoke', matrixId: 'script.smokes.safe', coverage: 'exact', rationale: 'offline memory smoke uses temporary local metadata fixtures.' },
  { script: 'context:smoke', matrixId: 'script.smokes.safe', coverage: 'exact', rationale: 'offline context smoke builds mock context with temporary memory and read-only tool metadata.' },
  { script: 'tokens:smoke', matrixId: 'script.smokes.safe', coverage: 'exact', rationale: 'offline token math smoke only.' },
  { script: 'session:smoke', matrixId: 'script.smokes.safe', coverage: 'exact', rationale: 'offline session metadata smoke.' },
  { script: 'replay:smoke', matrixId: 'script.smokes.safe', coverage: 'exact', rationale: 'offline replay smoke validates stored metadata behavior.' },
  { script: 'conversation:smoke', matrixId: 'script.smokes.safe', coverage: 'exact', rationale: 'offline conversation metadata smoke.' },
  { script: 'current:smoke', matrixId: 'script.smokes.safe', coverage: 'exact', rationale: 'offline current-session metadata smoke.' },
  { script: 'config:smoke', matrixId: 'script.smokes.safe', coverage: 'exact', rationale: 'offline config smoke with synthetic fixtures.' },
  { script: 'streaming:smoke', matrixId: 'script.smokes.safe', coverage: 'exact', rationale: 'offline streaming fixture smoke.' },
  { script: 'streaming:agent-smoke', matrixId: 'script.smokes.safe', coverage: 'exact', rationale: 'offline/mock agent streaming fixture smoke.' },
  { script: 'streaming:log-smoke', matrixId: 'script.smokes.safe', coverage: 'exact', rationale: 'offline streaming log fixture smoke.' },
  { script: 'cli:smoke', matrixId: 'script.smokes.safe', coverage: 'exact', rationale: 'offline CLI smoke for safe command paths.' },
  { script: 'batch:smoke', matrixId: 'script.smokes.safe', coverage: 'exact', rationale: 'offline batch dry-run smoke.' },
  { script: 'heartbeat:smoke', matrixId: 'script.smokes.safe', coverage: 'exact', rationale: 'offline heartbeat planning smoke.' },
  { script: 'tui:smoke', matrixId: 'script.smokes.safe', coverage: 'exact', rationale: 'offline TUI smoke.' },
  { script: 'bin:smoke', matrixId: 'script.smokes.safe', coverage: 'exact', rationale: 'offline package binary smoke.' },
  { script: 'providers:smoke', matrixId: 'script.smokes.safe', coverage: 'exact', rationale: 'offline provider catalog smoke without live provider calls.' },
  { script: 'providers:readiness-smoke', matrixId: 'script.smokes.safe', coverage: 'exact', rationale: 'offline static provider readiness report smoke without env, network, or provider calls.' },
  { script: 'approval:smoke', matrixId: 'script.smokes.safe', coverage: 'exact', rationale: 'offline approval metadata smoke.' },
  { script: 'typecheck', matrixId: 'script.typecheck', coverage: 'exact', rationale: 'compiler no-emit check.' },
  { script: 'profiles:smoke', matrixId: 'script.smokes.safe', coverage: 'exact', rationale: 'offline profile smoke.' },
  { script: 'policy:smoke', matrixId: 'script.smokes.safe', coverage: 'exact', rationale: 'offline policy smoke.' },
  { script: 'security:readonly-audit', matrixId: 'script.smokes.safe', coverage: 'exact', rationale: 'offline static matrix audit.' },
  { script: 'security:readonly-smoke', matrixId: 'script.smokes.safe', coverage: 'exact', rationale: 'offline static matrix smoke.' },
  { script: 'subagents:smoke', matrixId: 'script.smokes.safe', coverage: 'exact', rationale: 'offline subagent metadata smoke.' },
  { script: 'trace:summary', matrixId: 'script.smokes.safe', coverage: 'exact', rationale: 'local trace summary CLI; raw artifact reads remain policy-denied outside sanitized summaries.' },
  { script: 'trace:summary:json', matrixId: 'script.smokes.safe', coverage: 'exact', rationale: 'local trace summary JSON CLI; raw artifact reads remain policy-denied outside sanitized summaries.' },
  { script: 'eval:list', matrixId: 'cli.eval.list', coverage: 'exact', rationale: 'lists eval scenario/report metadata only.' },
  { script: 'eval:smoke', matrixId: 'script.eval-mock', coverage: 'exact', rationale: 'explicit mock eval suite.' },
  { script: 'eval:mock', matrixId: 'script.eval-mock', coverage: 'exact', rationale: 'all-suite mock eval runner.' },
  { script: 'eval:core', matrixId: 'script.eval-mock', coverage: 'exact', rationale: 'explicit mock eval suite.' },
  { script: 'eval:mcp', matrixId: 'script.eval-mock', coverage: 'exact', rationale: 'explicit mock eval suite.' },
  { script: 'eval:lsp', matrixId: 'script.eval-mock', coverage: 'exact', rationale: 'explicit mock eval suite.' },
  { script: 'eval:policy', matrixId: 'script.eval-mock', coverage: 'exact', rationale: 'explicit mock eval suite.' },
  { script: 'eval:profiles', matrixId: 'script.eval-mock', coverage: 'exact', rationale: 'explicit mock eval suite with local profile fixture.' },
  { script: 'eval:subagents', matrixId: 'script.eval-mock', coverage: 'exact', rationale: 'explicit mock eval suite.' },
  { script: 'eval:memory', matrixId: 'script.eval-mock', coverage: 'exact', rationale: 'explicit mock eval suite.' },
  { script: 'eval:context', matrixId: 'script.eval-mock', coverage: 'exact', rationale: 'explicit mock eval suite.' },
  { script: 'eval:tokens', matrixId: 'script.eval-mock', coverage: 'exact', rationale: 'explicit mock eval suite.' },
  { script: 'eval:session', matrixId: 'script.eval-mock', coverage: 'exact', rationale: 'explicit mock eval suite.' },
  { script: 'eval:approval', matrixId: 'script.eval-mock', coverage: 'exact', rationale: 'explicit mock eval suite.' },
  { script: 'eval:run-replay', matrixId: 'script.eval-mock', coverage: 'exact', rationale: 'explicit mock eval suite.' },
  { script: 'eval:conversation', matrixId: 'script.eval-mock', coverage: 'exact', rationale: 'explicit mock eval suite.' },
  { script: 'eval:current', matrixId: 'script.eval-mock', coverage: 'exact', rationale: 'explicit mock eval suite.' },
  { script: 'eval:config', matrixId: 'script.eval-mock', coverage: 'exact', rationale: 'explicit mock eval suite.' },
  { script: 'eval:streaming', matrixId: 'script.eval-mock', coverage: 'exact', rationale: 'explicit mock eval suite.' },
  { script: 'eval:llm', matrixId: 'script.eval-mock', coverage: 'exact', rationale: 'explicit mock eval suite.' },
  { script: 'eval:cli', matrixId: 'script.eval-mock', coverage: 'exact', rationale: 'explicit mock eval suite.' },
  { script: 'eval:batch', matrixId: 'script.eval-mock', coverage: 'exact', rationale: 'explicit mock eval suite.' },
  { script: 'eval:heartbeat', matrixId: 'script.eval-mock', coverage: 'exact', rationale: 'explicit mock eval suite.' },
  { script: 'eval:tui', matrixId: 'script.eval-mock', coverage: 'exact', rationale: 'explicit mock eval suite.' },
  { script: 'eval:release', matrixId: 'script.eval-mock', coverage: 'exact', rationale: 'explicit mock eval suite.' },
  { script: 'eval:quality', matrixId: 'script.eval-mock', coverage: 'exact', rationale: 'explicit mock eval suite.' },
  { script: 'eval:providers', matrixId: 'script.eval-mock', coverage: 'exact', rationale: 'explicit mock eval suite.' },
  { script: 'eval:provider-readiness', matrixId: 'script.eval-mock', coverage: 'exact', rationale: 'explicit mock provider readiness eval suite; offline but writes eval report metadata.' },
  { script: 'eval:report-smoke', matrixId: 'script.smokes.safe', coverage: 'exact', rationale: 'offline sanitized eval report smoke.' },
  { script: 'eval:report', matrixId: 'script.eval-mock', coverage: 'exact', rationale: 'explicit mock report eval suite.' },
  { script: 'eval:slo-smoke', matrixId: 'script.smokes.safe', coverage: 'exact', rationale: 'offline sanitized SLO dashboard smoke with temporary fixtures.' },
  { script: 'eval:slo', matrixId: 'script.eval-mock', coverage: 'exact', rationale: 'explicit mock SLO dashboard eval suite.' },
  { script: 'eval:replay', matrixId: 'cli.eval.runner', coverage: 'blocked-category', rationale: 'replay mode is outside read-only package-script coverage.' },
  { script: 'eval', matrixId: 'cli.eval.runner', coverage: 'blocked-category', rationale: 'default eval runner is outside read-only package-script coverage.' },
] as const;

export function findMatrixEntry(id: string): SafetyMatrixEntry | undefined {
  return readOnlySafetyMatrix.find((item) => item.id === id);
}

export function entriesByClassification(classification: SafetyClassification): SafetyMatrixEntry[] {
  return readOnlySafetyMatrix.filter((item) => item.classification === classification);
}

export function isPureReadOnly(entryValue: SafetyMatrixEntry): boolean {
  return entryValue.classification === 'pure-read-only';
}

export function isDangerousOrMutating(entryValue: SafetyMatrixEntry): boolean {
  return entryValue.classification === 'dangerous-blocked'
    || entryValue.classification === 'mutating'
    || entryValue.classification === 'live-provider';
}
