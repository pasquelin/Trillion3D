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
 *  the default, returns it; anything else passes it through or drops it), and whether a shell
 *  starts it — on Windows by default, where a `.cmd` (pnpm, npm) starts no other way; a real
 *  executable whose arguments carry quotes or spaces passes `shell: false`. */
interface RunOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  stdio?: StdioOptions
  shell?: boolean
}

/** Runs `command` and returns its output, or throws with its status and error output when it fails.
 *  A piped output may reach a gigabyte (a disassembly). */
export function runChecked(
  command: string,
  args: readonly string[],
  { cwd, env, stdio = 'pipe', shell = process.platform === 'win32' }: RunOptions = {},
): string {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio,
    maxBuffer: 1 << 30,
    shell,
  })
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error(
      `${command} ${args.join(' ')} failed (${result.status}, ${result.signal})\n${result.stderr ?? ''}`,
    )
  return result.stdout ?? ''
}
