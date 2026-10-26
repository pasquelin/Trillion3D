import { distanceSqVector3, writeDividedVector3 } from '../../../math/src/vector/vector.ts'
import { inverseAtRenderOrigin } from '../../../math/src/projection/renderOrigin.ts'
import type { ParticlePool } from '../../../sdk-core/src/fluids/particles.ts'
import { usedSlots } from './gpu/poolStates.ts'
import { ADD_ONE, KEEP } from '../blend/equations.ts'
import { BLEND_EQUATIONS } from '../materials/surface/materialBlending.ts'
import { BAKE_LAYOUT } from '../lighting/toneBakeWgsl.ts'
import { fieldLayout } from '../gpu/core/fieldLayout.ts'
import { wgslStruct } from '../../../math/src/wgsl/decl.ts'
import { cameraForward } from '../camera/forward.ts'
import { translucencyPassBit } from '../blend/translucencyPasses.ts'

/** The words the particle draw gives a pool, one table for the shader's `Draw` struct and the
 *  words written into it: a clip matrix from the pool's origin and its inverse, made in double
 *  precision; the view's right, up and forward axes in the world (`writeViewAxes`), the softness
 *  and the display scale in the room the axes leave; how the image shows the pool — display curve,
 *  unlit flag, pre-exposure and the size it draws —, a copy of the tone table's baking words
 *  (`BAKE_LAYOUT`) which a disc drawn on display values shows its colour through, and the factor
 *  its colour and opacity reach at death. The words of the view's clip plane, from the pool's
 *  origin, follow them where a module cuts at it (`writeDrawWords`). */
const DRAW_FIELDS = [
  ['clip', 'mat4x4f'],
  ['unclip', 'mat4x4f'],
  ['right', 'vec3f'],
  ['softness', 'f32'],
  ['up', 'vec3f'],
  ['exposure', 'f32'],
  ['forward', 'vec3f'],
  ['curve', 'f32'],
  ['unlit', 'f32'],
  ['preExposure', 'f32'],
  ['drawn', 'vec2f'],
  ['bake', { wgsl: BAKE_LAYOUT.name, words: BAKE_LAYOUT.words, align: BAKE_LAYOUT.align }],
  ['ending', 'vec4f'],
] as const
const PLAIN = fieldLayout('Draw', DRAW_FIELDS),
  CLIPPED = fieldLayout('Draw', DRAW_FIELDS, 'clipPlane:vec4f,')
/** Each field's first word in a pool's words. */
export const DRAW = PLAIN
/** The declaration of the struct `Draw`, ended by the view's clip plane in a module that cuts at it, which
 *  a program lists. */
export const drawStruct = (clipped: boolean) =>
  wgslStruct('Draw', [], (clipped ? CLIPPED : PLAIN).wgsl)
/** The first word of the view's clip plane, after the table's. */
const PLANE_AT = DRAW.words
/** The words of a pool's draw, the clip plane's four included. */
export const DRAW_FLOATS = PLANE_AT + 4

/** Each blend's factors on the translucency target, one table for both draws, the layers' own
 *  (`../materials/surface/materialBlending.ts`): smoke, its colour premultiplied by its coverage,
 *  covers as an alphaComposite layer does; fire adds its light and leaves the transmittance as an
 *  additive layer does, its colour already weighed by the coverage. The composition lays the
 *  pixel's coverage over the image (`composeTranslucency`). */
export const BLENDS: Record<ParticlePool['blend'], GPUBlendState> = {
  additive: { color: ADD_ONE, alpha: KEEP },
  premultiplied: BLEND_EQUATIONS.alphaComposite,
}

type Vec = ArrayLike<number>
const NO_PLANE: Vec = [0, 0, 0, 0]
const [clip, unclip] = [new Float64Array(16), new Float64Array(16)]
const looking = new Float64Array(3)

/** Writes the view's axes into `out`, for every pool the image draws: the world directions of the
 *  camera's right and up, which a disc is spread along, and of the way it looks, along which the
 *  soft edge is measured, each of unit length, from the camera's `world` matrix. */
export function writeViewAxes(out: Float32Array, world: Vec) {
  writeDividedVector3(out, DRAW.at.right, world[0], world[1], world[2])
  writeDividedVector3(out, DRAW.at.up, world[4], world[5], world[6])
  out.set(cameraForward(looking, world), DRAW.at.forward)
}

/** Writes `pool`'s draw words into `out` from the image's world `viewProj` and the view's clip
 *  plane `plane` — `dot(xyz, p) + w` at least 0 drawn in the world, none for all zeros — moved to
 *  the pool's origin: its particles' positions are read from there. The view's axes
 *  (`writeViewAxes`) and how the image shows the pool are the same for every pool: written before. */
export function writeDrawWords(
  out: Float32Array,
  pool: ParticlePool,
  viewProj: Vec,
  plane: Vec = NO_PLANE,
) {
  const o = pool.origin
  inverseAtRenderOrigin(unclip, clip, viewProj, o)
  out.set(clip, DRAW.at.clip)
  out.set(unclip, DRAW.at.unclip)
  out[DRAW.at.softness] = pool.softness
  out.set(pool.fade, DRAW.at.ending)
  for (let i = 0; i < 3; i++) out[PLANE_AT + i] = plane[i]
  out[PLANE_AT + 3] = plane[3] + plane[0] * o[0] + plane[1] * o[1] + plane[2] * o[2]
}

const keys: number[] = []

/** Whether `pool` draws: it has particles alive, in one of the set of passes `passes`
 *  (`translucencyPassBit`) where one is given. */
const drawsPool = (pool: ParticlePool, passes?: number) =>
  pool.moving &&
  usedSlots(pool) > 0 &&
  (!passes || (passes & translucencyPassBit(pool.translucencyPass)) !== 0)

/** Whether one of `pools` draws (`drawsPool`). */
export function anyDrawn(pools: readonly ParticlePool[], passes?: number) {
  for (const pool of pools) if (drawsPool(pool, passes)) return true
  return false
}

/** The pools that draw (`drawsPool`), in `into`, far to near from `eye` by origin: one emitter's
 *  smoke over the one behind it, nothing sorted within a pool, nothing allocated. */
export function drawOrder(
  pools: readonly ParticlePool[],
  eye: Vec,
  into: ParticlePool[],
  passes?: number,
) {
  into.length = 0
  for (const pool of pools) {
    if (!drawsPool(pool, passes)) continue
    const key = distanceSqVector3(pool.origin, eye)
    let at = into.length
    for (; at > 0 && keys[at - 1] < key; at--) {
      into[at] = into[at - 1]
      keys[at] = keys[at - 1]
    }
    into[at] = pool
    keys[at] = key
  }
  return into
}
