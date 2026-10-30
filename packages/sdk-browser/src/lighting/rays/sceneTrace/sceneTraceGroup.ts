import { createWebgpuBindIdentity } from '../../../gpu/bind/bindIdentity.ts'
import type { SceneTrace } from './sceneTraceResources.ts'
import { sceneMaskBindEntries } from './sceneMaskWgsl.ts'
import { sceneTraceBindEntries } from './sceneTraceWgsl.ts'

type GroupTrace = Pick<SceneTrace, 'params' | 'geometry' | 'table' | 'maskReads'>

/** The resources a group of the scene trace names, written into `into` from `at` in the order its bind identity compares them: the trace's, then the any-hit test's
 *  (`masked`); the place past the last written. */
function nameResources(into: unknown[], at: number, sceneTrace: GroupTrace, masked: boolean) {
  into[at++] = sceneTrace.params
  into[at++] = sceneTrace.geometry
  into[at++] = sceneTrace.table
  if (!masked) return at
  const mask = sceneTrace.maskReads
  into[at++] = mask.sampler
  into[at++] = mask.table
  into[at++] = mask.frame
  for (const view of mask.color.views) into[at++] = view
  into[at++] = mask.color.pages.buffer
  return at
}

/** The resources a group of the scene trace and its any-hit test names, in the order its bind identity compares them: written into `into`
 *  (emptied first) where a caller keeps one, so an image allocates none. */
export const sceneTraceGroupResources = (sceneTrace: GroupTrace, into: unknown[] = []) => {
  into.length = nameResources(into, 0, sceneTrace, true)
  return into
}

/** The bind group entries of the scene trace and its any-hit test from `first` (`sceneMaskedLayoutEntries` is their layout). */
export const sceneTraceGroupEntries = (sceneTrace: GroupTrace, first: number) => [
  ...sceneTraceBindEntries(sceneTrace, first),
  ...sceneMaskBindEntries(sceneTrace.maskReads, first),
]

/**
 * The bind group of the scene trace's resources a pass binds beside its own: the one binder of it. The group it returns is made again only
 * where the layout it is made for or a resource it names is not what the last call named. Every ray honours the masks of the surfaces
 * (`sceneTraceGroupEntries`, whose layout is `sceneMaskedLayoutEntries`), unless the pass's layout is the trace's alone (`masked` false).
 */
export function sceneTraceGroupBinder(device: GPUDevice, masked = true) {
  const identity = createWebgpuBindIdentity()
  let group: GPUBindGroup | undefined
  return (layout: GPUBindGroupLayout, sceneTrace: GroupTrace, first: number) => {
    const { next } = identity
    next[0] = layout
    next.length = nameResources(next, 1, sceneTrace, masked)
    if (identity.moved())
      group = device.createBindGroup({
        layout,
        entries: masked
          ? sceneTraceGroupEntries(sceneTrace, first)
          : sceneTraceBindEntries(sceneTrace, first),
      })
    return group!
  }
}
