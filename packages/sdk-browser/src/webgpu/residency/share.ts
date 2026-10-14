import type { FrameClock } from '../../page/integration/frameBudget.ts'

/**
 * THE ONE SHARE STEP of a loop that spends the frame's main-thread clock (`residentEnsurer.ts`):
 * before each page the clock runs again — a frame that ran during an await stopped it —; while the
 * share admits, the step gives nothing and the loop goes on at once; past it, the clock stops and
 * the step gives the next share's opening (`nextShare`), which the loop awaits before it reads
 * again what may have moved meanwhile.
 */
export const createShare =
  (budget: Pick<FrameClock, 'resume' | 'admits' | 'pause'>, nextShare: () => Promise<void>) =>
  (): Promise<void> | undefined => {
    budget.resume()
    if (budget.admits()) return undefined
    budget.pause()
    return nextShare()
  }
