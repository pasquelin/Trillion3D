import { BOUNCE_MAX_LEVELS } from '../../../../sdk-core/src/bounce/contracts.ts'
import type { BounceCascades } from '../../../../sdk-core/src/bounce/cascades.ts'
import { SCREEN_PROBE_CONSTANTS } from '../../../../sdk-core/src/bounce/screenProbeLevels.ts'
import { MAX_TRACE_DISTANCE_METRES } from '../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { arrayOf, fieldLayout } from '../../gpu/core/fieldLayout.ts'

/** A level of probes, one vector: its lowest cell (`base`) and its cell's side (`spacing`). */
export const BOUNCE_LEVEL = fieldLayout('BounceLevel', [
  ['base', 'vec3f'],
  ['spacing', 'f32'],
] as const)

/**
 * `BounceGrid`, one table the writer's words and the shaders' struct are both drawn from
 * (`fieldLayout`): the range (`reach.x`) and the scale of the nearest a probe's ray starts at over its cell's diagonal (`reach.y`), the
 * pre-exposure the radiance cache's light is kept under (`reach.z`, which the trace multiplies the light by) and its inverse (`reach.w`,
 * which a read of the cache multiplies by), the sizes
 * of the levels (`counts`: cells along a side, levels, cells a level, probes in the pool), the frame state
 * (`frame`: a spare word, the probes dispatched — written by the GPU: the pool's last pass puts the count of the probes it queued there
 * (`pool/poolWgsl.ts`) —, the frame counter), the eye (`eye`, the light functions' fade is measured
 * from), the direction the view looks along (`forward`: its xyz; its w is one under an orthographic view, where a distance to the camera is
 * measured along it, zero under a perspective one), then every level the declared count holds.
 */
export const BOUNCE_GRID = fieldLayout('BounceGrid', [
  ['reach', 'vec4f'],
  ['counts', 'vec4u'],
  ['frame', 'vec4u'],
  ['eye', 'vec4f'],
  ['forward', 'vec4f'],
  ['levels', arrayOf(BOUNCE_LEVEL, BOUNCE_MAX_LEVELS)],
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

/** The levels of `cascades` written word by word into `floats`: every encoded frame does it, so it
 *  allocates nothing. */
function writeGridLevels(floats: Float32Array, cascades: BounceCascades) {
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
 * It is written once at construction for what never moves — sizes — and once per
 * encoded frame for what moves: the range, the base cells of the levels, which follow the eye, and the work
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
    // The pool's last pass writes the count of the probes it queued into it, as storage.
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  floats[G.reach] = MAX_TRACE_DISTANCE_METRES
  floats[G.reach + 1] = SCREEN_PROBE_CONSTANTS.radianceProbeMinTraceScale
  floats[G.reach + 2] = floats[G.reach + 3] = 1
  integers.set([cascades.size, cascades.levels.length, cascades.cells, cascades.probes], G.counts)
  const upload = () => device.queue.writeBuffer(buffer, 0, packed)
  const writeLevels = () => writeGridLevels(floats, cascades)
  writeLevels()
  upload()
  return {
    buffer,
    /** Encoded-frame state: the range of the rays (`screenProbeMaxTraceDistance`), the scale of the nearest they start at (`minTraceScale`), the
     *  pre-exposure the cache's light is kept under (`preExposure`), the frame counter, the eye, the direction an orthographic view looks along (`forward`, none under a perspective one), then the levels; the
     *  count of the probes queued is the GPU's to write. */
    write(
      frame: number,
      eye: ArrayLike<number>,
      reach: number,
      minTraceScale: number,
      preExposure: number,
      forward?: ArrayLike<number>,
    ) {
      floats[G.reach] = reach
      floats[G.reach + 1] = minTraceScale
      floats[G.reach + 2] = preExposure
      floats[G.reach + 3] = 1 / preExposure
      integers[G.frame + 1] = 0
      integers[G.frame + 2] = frame
      for (let axis = 0; axis < 3; axis++) floats[G.eye + axis] = eye[axis]
      // The direction an orthographic view looks along; none under a perspective one.
      for (let axis = 0; axis < 3; axis++) floats[G.forward + axis] = forward?.[axis] ?? 0
      floats[G.forward + 3] = forward ? 1 : 0
      writeLevels()
      upload()
    },
    dispose() {
      buffer.destroy()
    },
  }
}
