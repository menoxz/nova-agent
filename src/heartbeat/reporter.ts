import type { HeartbeatTickReport } from './types.js';

export function renderHeartbeatMarkdown(report: HeartbeatTickReport): string {
  const lines: string[] = [];
  lines.push(`# Nova Heartbeat Report — ${escapeMarkdown(report.tickId)}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Status: **${report.status}**`);
  lines.push(`- Dry run: **${report.dryRun}**`);
  lines.push(`- Heartbeat enabled: **${report.config.enabled}**`);
  lines.push(`- Started: ${report.startedAt}`);
  lines.push(`- Finished: ${report.finishedAt}`);
  lines.push(`- Duration: ${report.durationMs} ms`);
  lines.push(`- Counts: total ${report.counts.total}, due ${report.counts.due}, skipped ${report.counts.skipped}, blocked ${report.counts.blocked}, needs_user_action ${report.counts.needsUserAction}`);
  lines.push('');
  lines.push('## Safety');
  lines.push('');
  lines.push(`- LLM invoked: ${report.safety.llmInvoked}`);
  lines.push(`- Tools invoked: ${report.safety.toolsInvoked}`);
  lines.push(`- Autonomous actions executed: ${report.safety.autonomousActionsExecuted}`);
  lines.push(`- Secrets included: ${report.safety.secretsIncluded}`);
  lines.push(`- Content policy: ${report.safety.contentPolicy}`);
  for (const note of report.safety.notes) lines.push(`- ${escapeMarkdown(note)}`);
  lines.push('');
  lines.push('## Tasks');
  lines.push('');
  lines.push('| ID | Kind | Action | Schedule | Status | Reason |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const task of report.tasks) {
    const schedule = task.schedule.type === 'interval' ? `interval/${task.schedule.everyMinutes ?? '?'}m` : task.schedule.type;
    lines.push(`| ${escapeCell(task.id)} | ${escapeCell(task.kind)} | ${escapeCell(task.action ?? '-')} | ${escapeCell(schedule)} | ${escapeCell(task.status)} | ${escapeCell(task.reason)} |`);
  }
  lines.push('');
  lines.push('Heartbeat V1 is planning-only: no daemon, no LLM call, no tool execution and no autonomous write/shell/git/network/memory action.');
  return `${lines.join('\n')}\n`;
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\*_`#[\]]/g, (match) => `\\${match}`);
}

function escapeCell(value: string): string {
  return escapeMarkdown(value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' '));
}
