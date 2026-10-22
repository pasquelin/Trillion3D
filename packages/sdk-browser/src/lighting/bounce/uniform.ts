import { BOUNCE_SETTINGS } from '../../../../sdk-core/src/bounce/contracts.ts'
import type { BounceCascades } from '../../../../sdk-core/src/bounce/cascades.ts'
import { TILE_NO_SLICE } from '../tiles/noSlice.ts'
import { arrayOf, fieldLayout } from '../../gpu/core/fieldLayout.ts'

/** A level of probes, one vector: its lowest cell (`base`) and its cell's side (`spacing`). */
export const BOUNCE_LEVEL = fieldLayout('BounceLevel', [
  ['base', 'vec3f'],
  ['spacing', 'f32'],
] as const)

/**
 * `BounceGrid`, one table the writer's words and the shaders' struct are both drawn from
 * (`fieldLayout`): the range and the diagnostic view (`reach.xy`), the sizes of the levels
 * (`counts`: cells along a side, levels, cells a level, probes in the pool), the frame state
 * (`frame`: light revision, probes dispatched, frame counter), the
 * world light grid (`lists`: its records' first word in the light grid's buffer, `TILE_NO_SLICE` for
 * none, and its cells along a side; `lattice`: its lowest corner and the side of its cell,
 * `bounceLightSlice`), then every level the declared count holds.
 */
export const BOUNCE_GRID = fieldLayout('BounceGrid', [
  ['reach', 'vec4f'],
  ['counts', 'vec4u'],
  ['frame', 'vec4u'],
  ['lists', 'vec4u'],
  ['lattice', 'vec4f'],
  ['levels', arrayOf(BOUNCE_LEVEL, BOUNCE_SETTINGS.cascadeLevels)],
] as const)

/**
 * Bytes of `BounceGrid`, the single source of truth: this uniform, the WGSL struct its readers
 * declare, and the substitute buffer a frame without bounce reads all have the
 * same size. An added cascade level grows it on all three sides at once, never on one —
 * a substitute smaller than the struct fails the binding, hence loses the device, and that
 * is exactly what a hand-written number has already cost.
 */
export const BOUNCE_GRID_BYTES = BOUNCE_GRID.words * 4

const G = BOUNCE_GRID.at,
  L = BOUNCE_LEVEL.at

/** The lattice and the levels of `cascades` written word by word into `floats`: every encoded frame
 *  does it, so it allocates nothing. */
function writeGridLevels(floats: Float32Array, cascades: BounceCascades) {
  floats.set(cascades.lattice.corner, G.lattice)
  floats[G.lattice + 3] = cascades.lattice.spacing
  for (let index = 0; index < cascades.levels.length; index++) {
    const { base, spacing } = cascades.levels[index],
      at = G.levels + index * BOUNCE_LEVEL.words
    for (let axis = 0; axis < 3; axis++) floats[at + L.base + axis] = base[axis]
    floats[at + L.spacing] = spacing
  }
}

/**
 * The uniform the bounce's readers share: the probe pass, deferred resolve and the reflections'
 * proxy hits read the same description of the levels, at the same slot.
 *
 * It is written once at construction for what never moves — range, sizes — and once per
 * encoded frame for what moves: the base cells of the levels, which follow the eye, and the work
 * the frame holds. Deferred resolve rereads it every frame, even when converged,
 * when no pass is encoded any more: that is why it is never zeroed.
 */
export function createBounceUniform(device: GPUDevice, cascades: BounceCascades) {
  const packed = new ArrayBuffer(BOUNCE_GRID_BYTES)
  const floats = new Float32Array(packed)
  const integers = new Uint32Array(packed)
  const buffer = device.createBuffer({
    label: 'Trillion3D bounce cascades v1',
    size: packed.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  floats[G.reach] = cascades.reach
  integers.set([cascades.size, cascades.levels.length, cascades.cells, cascades.probes], G.counts)
  integers.set([TILE_NO_SLICE, BOUNCE_SETTINGS.lightGridSide], G.lists) // no lists yet: every light
  const upload = () => device.queue.writeBuffer(buffer, 0, packed)
  const writeLevels = () => writeGridLevels(floats, cascades)
  writeLevels()
  upload()
  let view = false
  return {
    buffer,
    /** Irradiance diagnostic view: it travels in the same uniform as the cascades. */
    setIrradianceView(on: boolean) {
      if (view === on) return
      view = on
      floats[G.reach + 1] = on ? 1 : 0
      upload()
    },
    /** Encoded-frame state: light revision, dispatched probes, frame counter, then the levels. */
    write(generation: number, groups: number, frame: number) {
      floats[G.reach] = cascades.reach
      integers[G.frame] = generation
      integers[G.frame + 1] = groups
      integers[G.frame + 2] = frame
      writeLevels()
      upload()
    },
    /** The world light grid's records' first word in the light grid's buffer, or `undefined`:
     *  none, every point walking every light (`bounceLightSlice`). */
    setLightLists(start: number | undefined) {
      const word = start ?? TILE_NO_SLICE
      if (integers[G.lists] === word) return
      integers[G.lists] = word
      // The levels with it: the lattice the lists were listed on, even in a frame no update writes.
      writeLevels()
      upload()
    },
    dispose() {
      buffer.destroy()
    },
  }
}
