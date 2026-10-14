import { spawnSync, type StdioOptions } from 'node:child_process'

/** Runs `command` with its output inherited, and exits with its status when it fails. */
export function run(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): void {
  const result = spawnSync(command, args, { stdio: 'inherit', env })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

/** How `runChecked` starts a command: its folder, its environment, where its output goes (`pipe`,
 *  the default, returns it; anything else passes it through or drops it), and whether it may be a
 *  `.cmd` (pnpm, npm, a hook's tool), which on Windows starts only through a shell. A real
 *  executable starts without one, its arguments passed as they are, quotes and spaces kept. */
interface RunOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  stdio?: StdioOptions
  cmd?: boolean
}

/** Runs `command` and returns its output, or throws with its status and error output when it fails.
 *  A piped output may reach a gigabyte (a disassembly). */
export function runChecked(
  command: string,
  args: readonly string[],
  { cwd, env, stdio = 'pipe', cmd = false }: RunOptions = {},
): string {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio,
    maxBuffer: 1 << 30,
    shell: cmd && process.platform === 'win32',
  })
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error(
      `${command} ${args.join(' ')} failed (${result.status}, ${result.signal})\n${result.stderr ?? ''}`,
    )
  return result.stdout ?? ''
}
