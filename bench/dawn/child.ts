// A child bench process, waited for without blocking the event loop: a signal the parent gets
// (Ctrl-C, a kill by its pid) reaches it, and a parent that exits stops it, so a bench never leaves
// a process measuring alone behind it.
import { spawn, type ChildProcess } from 'node:child_process';
import { constants } from 'node:os';

const children = new Set<ChildProcess>();
process.on('exit', () => {
  for (const child of children) child.kill('SIGTERM');
});
let exiting = false;
/** Ctrl-C, a kill or a closed terminal exits this process with the signal's code, its `exit`
 *  handlers run: its children stopped, its lock freed. Once per process. */
export function exitOnSignals() {
  if (exiting) return;
  exiting = true;
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const)
    process.once(signal, () => process.exit(128 + constants.signals[signal]));
}
// A run lent its lock takes no handler of the lock's own: the signals are handled here.
exitOnSignals();

/** Runs `node <args>` with `env`, its output on this process's or, `capture`, returned; killed past
 *  `timeoutMs`. Resolves to its exit code (or signal) and captured output. */
export function runChild(
  args: string[],
  env: NodeJS.ProcessEnv,
  capture: boolean,
  timeoutMs: number,
) {
  const child = spawn(process.execPath, args, {
    env,
    stdio: ['ignore', capture ? 'pipe' : 'inherit', 'inherit'],
  });
  children.add(child);
  let stdout = '';
  child.stdout?.setEncoding('utf8').on('data', (text: string) => (stdout += text));
  const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
  return new Promise<{ status: number | null; signal: string | null; stdout: string }>((resolve) =>
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      children.delete(child);
      resolve({ status, signal, stdout });
    }),
  );
}
