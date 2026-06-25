import { buildProductionReadinessReport } from './readiness.js';

export async function handleProductionCommand(args: string[]): Promise<boolean> {
  const [area, action] = args;
  if (area !== 'production') return false;

  if (action === 'readiness' || action === 'doctor' || action === undefined) {
    const report = buildProductionReadinessReport();
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.readiness.ready ? 0 : 1;
    return true;
  }

  console.error('Unknown Nova production command. Usage: nova production readiness | nova production doctor');
  process.exitCode = 1;
  return true;
}
