import { readFile } from 'node:fs/promises';

import { redactString } from '../policy/redact.js';
import { listSubagentRoles } from './registry.js';
import { parseSubagentTasks, planSubagentTasks } from './planner.js';

export async function handleSubagentsCommand(args: string[]): Promise<boolean> {
  const [area, action, ...rest] = args;
  if (area !== 'subagents') return false;
  if (action === 'roles' || action === 'list' || action === undefined) {
    console.log(JSON.stringify({
      count: listSubagentRoles().length,
      roles: listSubagentRoles().map((role) => ({
        id: role.id,
        label: role.label,
        purpose: role.purpose,
        values: role.values,
        readOnly: role.readOnly,
        defaultProfileId: role.defaultProfileId,
        defaultGrant: role.defaultGrant,
      })),
      safety: { defaultWrite: false, defaultShell: false, recursiveDelegation: false },
    }, null, 2));
    return true;
  }
  if (action === 'plan') {
    const file = rest.find((value) => !value.startsWith('-'));
    if (!file) return missingSubagentArgument('nova subagents plan <tasks.json>');
    try {
      const parsed = JSON.parse(await readFile(file, 'utf-8')) as unknown;
      console.log(JSON.stringify(planSubagentTasks(parseSubagentTasks(parsed)), null, 2));
      return true;
    } catch (err) {
      console.error(`Subagents plan error: ${redactString(err instanceof Error ? err.message : String(err), 1_000)}`);
      process.exitCode = 1;
      return true;
    }
  }
  console.error('Unknown Nova subagents command. Usage: nova subagents roles | nova subagents plan <tasks.json>');
  process.exitCode = 1;
  return true;
}

function missingSubagentArgument(usage: string): true {
  console.error(`Missing argument. Usage: ${usage}`);
  process.exitCode = 1;
  return true;
}
