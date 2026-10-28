// The layouts past the device's storage buffer limit, named before Dawn loses the device on them: Dawn's error names neither
// the pipeline layout nor its groups, so the bench keeps each bind group layout's entries and, when a pipeline layout binds more
// storage buffers in one stage than the device grants, says which groups do and how many each holds.
import { hookAfter, type Proto } from '../page/hook.ts'

const STAGES = [
  ['vertex', 1],
  ['fragment', 2],
  ['compute', 4],
] as const

/** The entries of each bind group layout made, by the layout. */
const entriesOf = new WeakMap<
  object,
  { label: string; entries: readonly GPUBindGroupLayoutEntry[] }
>()

/** The storage buffers `entries` binds in stage `bit`. */
const storageIn = (entries: readonly GPUBindGroupLayoutEntry[], bit: number) =>
  entries.filter(
    (entry) =>
      entry.visibility & bit &&
      (entry.buffer?.type === 'storage' || entry.buffer?.type === 'read-only-storage'),
  ).length

/** Hooks `createBindGroupLayout` and `createPipelineLayout` of the device prototype. */
export function guardLayouts(device: Proto) {
  hookAfter(device, 'createBindGroupLayout', (_self, [descriptor], made) => {
    const { label = '', entries } = descriptor as GPUBindGroupLayoutDescriptor
    entriesOf.set(made as object, { label, entries: [...entries] })
  })
  hookAfter(device, 'createPipelineLayout', (self, [descriptor]) => {
    const { label = '', bindGroupLayouts } = descriptor as GPUPipelineLayoutDescriptor
    const limit = (self as GPUDevice).limits.maxStorageBuffersPerShaderStage
    for (const [stage, bit] of STAGES) {
      const groups = Array.from(bindGroupLayouts, (layout) =>
        layout ? entriesOf.get(layout as object) : undefined,
      )
      const total = groups.reduce(
        (sum, group) => sum + (group ? storageIn(group.entries, bit) : 0),
        0,
      )
      if (total <= limit) continue
      const named = groups.map(
        (group, at) =>
          `group ${at} "${group?.label ?? '?'}" ${group ? storageIn(group.entries, bit) : '?'}`,
      )
      console.error(
        `[bench] layout "${label}": ${total} storage buffers in the ${stage} stage, past ${limit}: ${named.join(', ')}`,
      )
    }
  })
}
