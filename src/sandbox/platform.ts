/**
 * Platform support gate for the execution sandbox (ADR-002 Slice 3).
 *
 * The hardened-subprocess sandbox relies on OS-specific process-tree teardown
 * (`taskkill.exe` on Windows, POSIX process-group signals elsewhere). Only the
 * platforms on which that teardown is implemented and verified are considered
 * supported; on any other platform {@link ../probe.ts:probeExecutionSandbox}
 * stays closed so Gate C remains fail-closed.
 *
 * This module lives OUTSIDE `src/heartbeat/**` on purpose (see ADR-002 §D5):
 * the heartbeat static guard forbids process primitives under that tree.
 */

/** Platforms whose process-tree teardown is implemented in `sandbox.ts`. */
export type SandboxSupportedPlatform = 'win32' | 'linux' | 'darwin';

const SUPPORTED_PLATFORMS: ReadonlySet<NodeJS.Platform> = new Set<NodeJS.Platform>([
  'win32',
  'linux',
  'darwin',
]);

/**
 * Whether the current (or an injected) platform can run the hardened sandbox.
 *
 * @param platform Defaults to `process.platform`; injectable for tests.
 */
export function sandboxIsSupportedPlatform(platform: NodeJS.Platform = process.platform): boolean {
  return SUPPORTED_PLATFORMS.has(platform);
}
