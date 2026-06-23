export const HEARTBEAT_SCHEMA_VERSION = 2 as const;

export type HeartbeatTaskKind = 'inspection' | 'eval' | 'batch-dry-run' | 'maintenance' | string;
export type HeartbeatTaskAction = 'inspect' | 'eval' | 'batch-dry-run' | 'maintain' | string;

export interface HeartbeatScheduleConfig {
  type: 'manual' | 'interval';
  everyMinutes?: number;
  anchor?: string;
}

export interface HeartbeatTaskConfig {
  id: string;
  name?: string;
  enabled?: boolean;
  kind: HeartbeatTaskKind;
  action?: HeartbeatTaskAction;
  schedule?: HeartbeatScheduleConfig;
}

export interface HeartbeatConfig {
  enabled?: boolean;
  tasks?: HeartbeatTaskConfig[];
  timezone?: string;
  quietHours?: HeartbeatQuietWindow[];
}

export interface HeartbeatTaskState {
  lastRunAt?: string;
  lastDryRunAt?: string;
  lastStatus?: HeartbeatTaskResultStatus;
  /** Set only when a gated execution actually ran (ADR-002; Slice 1: never). */
  lastExecAt?: string;
  /** Outcome of the last gated execution decision (ADR-002). */
  lastExecStatus?: 'executed' | 'refused' | 'needs_user_action';
  /** Approval-workflow bookkeeping; populated in ADR-002 Slice 2. */
  pendingApprovalId?: string;
  pendingApprovalAt?: string;
  lastApprovalId?: string;
}

export interface HeartbeatState {
  schemaVersion: typeof HEARTBEAT_SCHEMA_VERSION;
  heartbeatId: string;
  enabled: boolean;
  updatedAt: string;
  lastTickId?: string;
  lastTickAt?: string;
  tasks: Record<string, HeartbeatTaskState>;
}

export type HeartbeatTaskResultStatus = 'due' | 'skipped' | 'blocked' | 'needs_user_action' | 'executed' | 'refused';
export type HeartbeatTickStatus = 'dry_run_completed' | 'blocked' | 'executed' | 'refused';

export interface HeartbeatTaskResult {
  id: string;
  name?: string;
  kind: string;
  action?: string;
  enabled: boolean;
  schedule: HeartbeatScheduleConfig;
  status: HeartbeatTaskResultStatus;
  reason: string;
  lastRunAt?: string;
  nextDueAt?: string;
}

export interface HeartbeatTickReport {
  schemaVersion: typeof HEARTBEAT_SCHEMA_VERSION;
  heartbeatId: string;
  tickId: string;
  status: HeartbeatTickStatus;
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  config: {
    enabled: boolean;
    taskCount: number;
  };
  counts: {
    total: number;
    due: number;
    skipped: number;
    blocked: number;
    needsUserAction: number;
  };
  tasks: HeartbeatTaskResult[];
  safety: {
    llmInvoked: boolean;
    toolsInvoked: boolean;
    autonomousActionsExecuted: boolean;
    secretsIncluded: false;
    contentPolicy: 'metadata-only-redacted';
    notes: string[];
  };
  paths: {
    json: string;
    markdown: string;
  };
}

export interface HeartbeatQuietWindow {
  start: string;
  end: string;
}

export type HeartbeatPlanTaskStatus =
  | 'projected'
  | 'manual'
  | 'skipped'
  | 'blocked'
  | 'needs_user_action';

export interface HeartbeatPlanOccurrence {
  at: string;
  classification: 'would_run' | 'quiet_hours';
  note?: string;
}

export interface HeartbeatPlanTask {
  id: string;
  name?: string;
  kind: string;
  action?: string;
  enabled: boolean;
  schedule: HeartbeatScheduleConfig;
  status: HeartbeatPlanTaskStatus;
  reason: string;
  firstDueAt?: string;
  occurrences: HeartbeatPlanOccurrence[];
}

export interface HeartbeatPlanReport {
  schemaVersion: typeof HEARTBEAT_SCHEMA_VERSION;
  heartbeatId: string;
  planId: string;
  generatedForNow: string;
  horizonMinutes: number;
  maxPerTask: number;
  timezone: string;
  heartbeatEnabled: boolean;
  preview: boolean;
  counts: {
    tasks: number;
    projected: number;
    quietHours: number;
    manual: number;
    skipped: number;
    blocked: number;
    needsUserAction: number;
    occurrences: number;
  };
  tasks: HeartbeatPlanTask[];
  safety: {
    llmInvoked: false;
    toolsInvoked: false;
    autonomousActionsExecuted: false;
    schedulerInstalled: false;
    secretsIncluded: false;
    contentPolicy: 'metadata-only-redacted';
    notes: string[];
  };
  paths: {
    json: string;
    markdown: string;
  };
}

export type HeartbeatAutomationTarget = 'windows-task' | 'systemd' | 'cron';

export interface HeartbeatAutomationManifest {
  target: HeartbeatAutomationTarget;
  tickEveryMinutes?: number;
  tickAt?: string;
  timezone: string;
  invokes: 'nova heartbeat tick --dry-run';
  installed: false;
  body: string;
  paths: { file?: string };
}
