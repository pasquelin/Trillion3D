// One play of a child run of a dissect or an A/B: its command line, the lock lent on, its report read
// and — whatever happened — removed, the child's end named by its code or its signal.
import { readFileSync, rmSync } from 'node:fs'
import { runChild } from './child.ts'
import { LOCK_OWNER } from './lock.ts'
import type { BenchPlay } from './play.ts'

/** Runs `run.ts` with `args` and writes its report to `report`; resolves to the play's numbers, or
 *  throws "`what` ended <code or signal>". `timeoutS` bounds the play. */
export async function playChild(
  args: readonly string[],
  env: Record<string, string>,
  report: string,
  what: string,
  timeoutS: number,
) {
  const child = await runChild(
    [process.argv[1], ...args, '--child-report', report],
    { ...process.env, [LOCK_OWNER]: process.env[LOCK_OWNER] ?? String(process.pid), ...env },
    false,
    timeoutS * 1000,
  )
  try {
    if (child.status !== 0) throw new Error(`${what} ended ${child.status ?? child.signal}`)
    return JSON.parse(readFileSync(report, 'utf8')) as BenchPlay
  } finally {
    rmSync(report, { force: true })
  }
}
