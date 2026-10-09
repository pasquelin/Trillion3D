/** What the cut's making tells as it reaches each of its sub-steps: a line naming it. */
export type CutProgress = (note: string) => void

/**
 * THE SUB-STEPS OF A CUT'S MAKING, TIMED: each named to `progress` as it begins — its tables, its
 * shader module, each pipeline as the device hands it back, its arm, its uploads —, with the time
 * since the making began, so an opening that waits names the sub-step it waits in, on any device
 * (`../../world/session/openWatch.ts`). `took` lists what each took once the making is over.
 */
export function cutSteps(progress: CutProgress = () => {}) {
  const start = performance.now()
  const took: { step: string; ms: number }[] = []
  let current = '',
    at = start
  const close = (now: number) => {
    if (current) took.push({ step: current, ms: Math.round(now - at) })
  }
  const since = (now: number) => `${((now - start) / 1000).toFixed(1)} s`
  return {
    /** `step` begins: the one before it ends. */
    begin(step: string) {
      const now = performance.now()
      close(now)
      current = step
      at = now
      progress(`${step}, at ${since(now)}`)
    },
    /** A note within the current sub-step — a pipeline handed back among those asked. */
    note(note: string) {
      progress(`${current}: ${note}, at ${since(performance.now())}`)
    },
    /** The making is over: what each sub-step took, and the whole. */
    end() {
      const now = performance.now()
      close(now)
      current = ''
      return { took, ms: Math.round(now - start) }
    },
  }
}

export type CutSteps = ReturnType<typeof cutSteps>
