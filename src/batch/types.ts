import type { ResponseTokenMetrics } from '../tokens/types.js';

export interface BatchItem {
  id: string;
  prompt: string;
  sourceLine?: number;
}

export interface BatchRunOptions {
  streaming?: boolean;
  eventLog?: boolean;
  reportPath?: string;
  reportMarkdownPath?: string;
  ci?: boolean;
  continueOnError?: boolean;
  dryRun?: boolean;
  limit?: number;
  onlyIds?: string[];
  fromId?: string;
  onItemStart?: (input: { item: BatchItem; index: number; total: number }) => void | Promise<void>;
  onItemFinish?: (input: { item: BatchItem; report: BatchItemReport; index: number; total: number }) => void | Promise<void>;
}

export type BatchItemStatus = 'success' | 'error' | 'skipped';
export type BatchReportStatus = 'completed' | 'failed' | 'partial';

export interface BatchItemReport {
  id: string;
  status: BatchItemStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  promptPreview: string;
  answerPreview?: string;
  error?: string;
  skipReason?: string;
  metrics?: ResponseTokenMetrics;
  run?: {
    sessionId?: string;
    runId?: string;
  };
  eventLog?: {
    logId?: string;
    path?: string;
  };
}

export interface BatchReport {
  schemaVersion: 1;
  batchId: string;
  status: BatchReportStatus;
  inputFile: string;
  reportPath?: string;
  reportMarkdownPath?: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  options: {
    streaming: boolean;
    eventLog: boolean;
    reportMarkdown: boolean;
    ci: boolean;
    continueOnError: boolean;
    dryRun: boolean;
    limit?: number;
    onlyIds?: string[];
    fromId?: string;
  };
  counts: {
    total: number;
    success: number;
    error: number;
    skipped: number;
  };
  items: BatchItemReport[];
}
