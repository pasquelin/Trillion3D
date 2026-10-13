import { createRecordTexture, type RecordLayout } from '../core/recordTexture.ts'
import { recordTextureWgsl, type RecordBinding } from '../core/recordTextureWgsl.ts'
import { constructGpuResources } from '../core/errorScope.ts'
import { retire } from '../core/frameRetire.ts'

/**
 * THE PROXY'S INSTANCES, one home whatever the world's size: a record table
 * (`../core/recordTexture.ts`) the proxy owns, a record an instance — its four words in one texel,
 * laid as `INSTANCE` says (`../../bounce/runtimeLayout.ts`): the cut's first node and first
 * triangle in the arena, the surface, the mark —, the placements' first, the blended copies' behind
 * them. The rays read it in place (`../../bounce/runtimeSceneWgsl.ts`), the host writes the
 * instances that moved (`proxyInstances.ts`).
 *
 * A row holds 1024 instances; a layer 8192 rows, 2²³ instances.
 */
export const INSTANCE_TABLE: RecordLayout = {
  label: 'Trillion3D run-time proxy instances',
  format: 'rgba32uint',
  fields: { Instance: 1 },
  rowShift: 10,
  layerShift: 13,
}

/** The instances as a program in `group` binds them at `binding`, named `name`:
 *  `<name>Instance(w,0u)`, instance `w`'s four words. */
export const instanceTableWgsl = (name: string, binding: Omit<RecordBinding, 'name'>) =>
  recordTextureWgsl(INSTANCE_TABLE, { name, ...binding })

/**
 * The proxy's instance table on `device`, made at the first need: what it holds of the words the
 * host keeps (`words`, four an instance), written whole whenever it is made — at least as large as
 * asked, twice the last when it grows, so a growth costs a constant a joined copy — and by the runs
 * of instances that moved.
 */
export function createProxyInstanceTable(device: GPUDevice) {
  let table: ReturnType<typeof createRecordTexture> | undefined,
    capacity = 0
  const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
  return {
    /** The view the programs bind, none before the first `hold`. */
    get view() {
      return table?.view
    },
    /** Bytes the table holds. */
    get bytes() {
      return table?.bytes ?? 0
    },
    /** A table that holds every instance of `words`: made, or replaced by a larger one, written
     *  whole; the one replaced retired after the frame that may name it (`retire`). */
    hold(words: Uint32Array) {
      const count = words.length / 4
      if (table && count <= capacity) return
      const old = table
      capacity = Math.max(1, count, 2 * capacity)
      // Made in the device's ledger, as every resource the engine allocates.
      table = constructGpuResources(device, () =>
        createRecordTexture(device, INSTANCE_TABLE, capacity, usage),
      )
      table.write('Instance', 0, count, words.buffer as ArrayBuffer, words.byteOffset)
      if (old) retire(device, old)
    },
    /** The `count` instances from `first` of `words`. */
    write(words: Uint32Array, first: number, count: number) {
      if (!table || count <= 0) return
      const at = words.byteOffset + first * 16
      table.write('Instance', first, count, words.buffer as ArrayBuffer, at)
    },
    destroy() {
      table?.destroy()
      table = undefined
      capacity = 0
    },
  }
}
