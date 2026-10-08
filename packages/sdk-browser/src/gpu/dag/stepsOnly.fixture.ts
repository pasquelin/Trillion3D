import type { GpuSelection, TableSync } from '../core/selection.ts'

/** `selection`, whose cuts take the steps registered before them (`GpuSelection.beforeCut`) for
 *  the main view and encode nothing: what its followers hand the tables before a cut, alone. */
export function stepsOnly<T extends Partial<GpuSelection>>(selection: T) {
  const steps: TableSync[] = [],
    main = {}
  selection.beforeCut = (step) => void steps.push(step)
  selection.dispatch = (uniforms) => {
    for (const step of steps) step(uniforms, main)
    return undefined
  }
  return selection as T & GpuSelection
}
