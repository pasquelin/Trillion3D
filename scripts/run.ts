import { spawnSync } from 'node:child_process'

/** Runs `command` with its output inherited, and exits with its status when it fails. */
export function run(command: string, args: readonly string[]): void {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

/** Runs `command` and returns its output, or throws with its status and error output when it fails;
 *  `inherit` passes the output through instead of returning it. */
export function runChecked(
  command: string,
  args: readonly string[],
  { cwd, env, inherit = false }: { cwd?: string; env?: NodeJS.ProcessEnv; inherit?: boolean } = {},
): string {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: inherit ? 'inherit' : 'pipe',
    shell: process.platform === 'win32',
  })
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error(
      `${command} ${args.join(' ')} failed (${result.status})\n${result.stderr ?? ''}`,
    )
  return result.stdout ?? ''
}
