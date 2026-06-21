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
  continueOnError?: boolean;
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
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  options: {
    streaming: boolean;
    eventLog: boolean;
    continueOnError: boolean;
  };
  counts: {
    total: number;
    success: number;
    error: number;
    skipped: number;
  };
  items: BatchItemReport[];
}
