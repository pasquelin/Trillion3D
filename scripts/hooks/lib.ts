// Shared by the tracked git hooks: every change reaches develop/main through an issue and a pull
// request, whoever (or whatever) types the command. Each file of `.githooks/` is a one-line shim
// onto a script of this folder, since git needs an executable there; `pnpm install` activates
// them (`git config core.hooksPath .githooks`, scripts/setup-development.ts). Git runs a hook from
// the worktree root. Each hook ends by delegating to the hook of the same name installed locally
// in .git/hooks, so core.hooksPath preserves personal hooks.
import { spawnSync, type SpawnSyncOptions } from 'node:child_process'
import { accessSync, constants, existsSync } from 'node:fs'
import { join } from 'node:path'

/** Stops the git command with its reason. */
export function refuse(reason: string): never {
  process.stderr.write(`git hook: ${reason}\n`)
  process.exit(1)
}

/** A git command's output, trimmed; empty when it fails (as `$(git …)` in a shell). */
export const git = (...args: string[]): string =>
  spawnSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).stdout.trim()

/**
 * Runs a gate of the repository from the worktree root, when the checkout has it (a repository
 * that only copies the hooks has none), and stops the git command when it fails.
 */
export function gate(command: string, args: string[], env: Record<string, string> = {}): void {
  if (!existsSync(args[0])) return
  // Git hands its hooks `GIT_DIR`, `GIT_INDEX_FILE` and the like: a test that makes a repository of
  // its own must not inherit them, or its git commands act on this one.
  const own = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
  )
  const run = spawnSync(command, args, { stdio: 'inherit', env: { ...own, ...env } })
  if (run.status !== 0) refuse(`${args[0]} failed: fix it before this command goes through.`)
}

/**
 * Runs the tool-installed hook `name` with the hook's own arguments, stdin forwarded as received
 * (or `input` when the hook already read it), and exits with its status when it fails. Hooks live
 * in the common dir (also from a linked worktree); --git-path would answer with core.hooksPath.
 */
export function runLocalHook(name: string, args: string[], input?: string): void {
  const hook = join(git('rev-parse', '--git-common-dir'), 'hooks', name)
  try {
    accessSync(hook, constants.X_OK)
  } catch {
    return
  }
  const stdin = input === undefined ? 'inherit' : 'pipe'
  const options: SpawnSyncOptions = { input, stdio: [stdin, 'inherit', 'inherit'] }
  let run = spawnSync(hook, args, options)
  // A hook the system cannot start by itself (no shebang, or a script on Windows) is started by
  // sh, as the former shell hooks did: sh reads its shebang, or runs it as a shell script.
  if (run.error) run = spawnSync('sh', ['-c', '"$0" "$@"', hook, ...args], options)
  if (run.error) throw run.error
  if (run.status !== 0) process.exit(run.status ?? 1)
}
