import type { WebgpuPagesRuntime } from '../runtime.ts'

/** `grow` queued behind the running prepare, which makes the GPU tables at the size it read, and
 *  behind every growth asked before it, in their order (`layout.growing`): the tables'
 *  (`growTables.ts`). */
export function queueTableGrowth<T>(rt: WebgpuPagesRuntime, grow: () => Promise<T>) {
  const run = async () => {
    await rt.setup.preparing
    return grow()
  }
  const growing = (rt.layout.growing ?? Promise.resolve()).then(run, run)
  rt.layout.growing = growing
  return growing
}
