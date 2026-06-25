import { redactString } from '../policy/redact.js';
import { builtInProfileCatalogue, findBuiltInProfileMetadata } from './catalogue.js';
import { doctorProfile } from './doctor.js';
import { resolveProfileSync } from './resolver.js';

export async function handleProfilesCommand(args: string[]): Promise<boolean> {
  const [area, action, ...rest] = args;
  if (area !== 'profiles') return false;
  if (action === 'list' || action === undefined) {
    console.log(JSON.stringify({ count: builtInProfileCatalogue().length, profiles: builtInProfileCatalogue() }, null, 2));
    return true;
  }
  if (action === 'show' && rest[0]) {
    const profile = findBuiltInProfileMetadata(rest[0]);
    if (!profile) return profileNotFound(rest[0]);
    console.log(JSON.stringify(profile, null, 2));
    return true;
  }
  if (action === 'doctor') {
    const ids = rest[0] ? [rest[0]] : builtInProfileCatalogue().map((profile) => profile.id);
    try {
      const reports = ids.map((id) => doctorProfile(resolveProfileSync({ profileId: id, includeCustom: false })));
      const ok = reports.every((report) => report.ok);
      console.log(JSON.stringify({ ok, count: reports.length, reports }, null, 2));
      process.exitCode = ok ? 0 : 1;
      return true;
    } catch (err) {
      console.error(`Profiles doctor error: ${redactString(err instanceof Error ? err.message : String(err), 1_000)}`);
      process.exitCode = 1;
      return true;
    }
  }
  if (action === 'show') return missingProfileArgument('nova profiles show <id>');
  console.error('Unknown Nova profiles command. Usage: nova profiles list | nova profiles show <id> | nova profiles doctor [id]');
  process.exitCode = 1;
  return true;
}

function profileNotFound(id: string): true {
  console.error(`Unknown Nova agent profile: ${redactString(id, 200)}`);
  process.exitCode = 1;
  return true;
}

function missingProfileArgument(usage: string): true {
  console.error(`Missing argument. Usage: ${usage}`);
  process.exitCode = 1;
  return true;
}
