import { spawnSync } from 'node:child_process';

/** Runs `command` with its output inherited, and exits with its status when it fails. */
export function run(command: string, args: readonly string[]): void {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
