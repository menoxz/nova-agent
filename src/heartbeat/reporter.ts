import type { HeartbeatPlanReport, HeartbeatTickReport } from './types.js';
import { safeHeartbeatPlanReport, safeHeartbeatReport } from './redaction.js';

export function renderHeartbeatMarkdown(report: HeartbeatTickReport): string {
  report = safeHeartbeatReport(report);
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

export function renderHeartbeatPlanMarkdown(report: HeartbeatPlanReport): string {
  report = safeHeartbeatPlanReport(report);
  const lines: string[] = [];
  lines.push(`# Nova Heartbeat Plan — ${escapeMarkdown(report.planId)}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Generated for: ${report.generatedForNow}`);
  lines.push(`- Horizon: ${report.horizonMinutes} minutes`);
  lines.push(`- Max per task: ${report.maxPerTask}`);
  lines.push(`- Timezone: ${escapeMarkdown(report.timezone)}`);
  lines.push(`- Heartbeat enabled: **${report.heartbeatEnabled}**`);
  lines.push(`- Preview (heartbeat disabled): **${report.preview}**`);
  lines.push(
    `- Counts: tasks ${report.counts.tasks}, projected ${report.counts.projected}, manual ${report.counts.manual}, skipped ${report.counts.skipped}, blocked ${report.counts.blocked}, needs_user_action ${report.counts.needsUserAction}, occurrences ${report.counts.occurrences} (quiet_hours ${report.counts.quietHours})`,
  );
  lines.push('');
  lines.push('## Safety');
  lines.push('');
  lines.push(`- LLM invoked: ${report.safety.llmInvoked}`);
  lines.push(`- Tools invoked: ${report.safety.toolsInvoked}`);
  lines.push(`- Autonomous actions executed: ${report.safety.autonomousActionsExecuted}`);
  lines.push(`- Scheduler installed: ${report.safety.schedulerInstalled}`);
  lines.push(`- Secrets included: ${report.safety.secretsIncluded}`);
  lines.push(`- Content policy: ${report.safety.contentPolicy}`);
  for (const note of report.safety.notes) lines.push(`- ${escapeMarkdown(note)}`);
  lines.push('');
  lines.push('## Tasks');
  lines.push('');
  lines.push('| ID | Kind | Action | Schedule | Status | First due | Occurrences | Reason |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const task of report.tasks) {
    const schedule = task.schedule.type === 'interval' ? `interval/${task.schedule.everyMinutes ?? '?'}m` : task.schedule.type;
    lines.push(
      `| ${escapeCell(task.id)} | ${escapeCell(task.kind)} | ${escapeCell(task.action ?? '-')} | ${escapeCell(schedule)} | ${escapeCell(task.status)} | ${escapeCell(task.firstDueAt ?? '-')} | ${task.occurrences.length} | ${escapeCell(task.reason)} |`,
    );
  }
  lines.push('');
  lines.push('## Projected occurrences');
  lines.push('');
  const withOccurrences = report.tasks.filter((task) => task.occurrences.length > 0);
  if (withOccurrences.length === 0) {
    lines.push('_No occurrences projected in this horizon._');
  } else {
    for (const task of withOccurrences) {
      lines.push(`### ${escapeMarkdown(task.id)}`);
      lines.push('');
      for (const occurrence of task.occurrences) {
        const note = occurrence.note ? ` — ${escapeMarkdown(occurrence.note)}` : '';
        lines.push(`- ${occurrence.at} — ${occurrence.classification}${note}`);
      }
      lines.push('');
    }
  }
  lines.push(
    'Heartbeat planning is projection-only: Nova does not schedule itself, performs no LLM/tool/network action, and installs no OS scheduler. Run `nova heartbeat tick --dry-run` to act on this plan.',
  );
  return `${lines.join('\n')}\n`;
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\*_`#[\]]/g, (match) => `\\${match}`);
}

function escapeCell(value: string): string {
  return escapeMarkdown(value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' '));
}
