import type { VisMaterial } from '../types.ts'
import { hypot3 } from '../../../../sdk-core/src/math/primitives/hypot.ts'
import { SHADOWLESS_ROOT } from './shadowlessRoot.ts'

/**
 * THE SPRITE: where a corner of a sprite's quad (`drawnSprite`, sdk-core `drawnSprite.ts`) stands
 * once turned to face the camera.
 *
 * `place` takes the sprite's local space to the world space `toClip` projects: the sprite's world
 * matrix, under every raster and the CPU one. The corner's `x` and `y` — already moved by the
 * sprite's centre — are scaled by the lengths of `place`'s first two axes, the sprite's own scale;
 * a sprite that keeps its size on screen (`sprite.y` below zero) scales them again by the clip `w`
 * of its origin, the view depth under a perspective camera and one under an orthographic one, as
 * the view depth of the origin alone multiplies them there. They then turn by `sprite.x` radians
 * and lie in the image plane about the origin, along the camera's right and up: the first two rows
 * of `toClip`, whose directions they are for any projection the engine composes. The corner keeps
 * the origin's view depth.
 *
 * `sprite` is `(rotation, mode)`: mode 1 for a sprite that shrinks with distance, −1 for one that
 * keeps its size on screen, 0 for every surface that is no sprite — which no raster moves.
 * The WGSL text and `spriteAt` below are the same arithmetic, in the same order.
 */
export const SPRITE_WGSL = `fn spriteAt(toClip:mat4x4f,place:mat4x4f,corner:vec2f,sprite:vec2f)->vec4f{
 let center=place[3];
 var a=corner*vec2f(length(place[0].xyz),length(place[1].xyz));
 if(sprite.y<0.0){a*=(toClip*center).w;}
 let c=cos(sprite.x);let s=sin(sprite.x);
 let r=normalize(vec3f(toClip[0].x,toClip[1].x,toClip[2].x));
 let u=normalize(vec3f(toClip[0].y,toClip[1].y,toClip[2].y));
 return vec4f(center.xyz+(c*a.x-s*a.y)*r+(s*a.x+c*a.y)*u,1.0);
}`

/** Writes the two words every raster reads of a surface (`sprite`, above) into `out` at `at`:
 *  zeros on a surface that draws no sprite. */
export function writeSpriteWords(
  out: { [index: number]: number },
  at: number,
  sprite: VisMaterial['sprite'],
) {
  out[at] = sprite?.rotation ?? 0
  out[at + 1] = !sprite ? 0 : sprite.sizeAttenuation ? 1 : -1
}

/**
 * THE NEVER-CULLED MARK: true on a sprite that keeps its size on screen (mode −1). Its quad grows
 * with its view depth, so no fixed world bound holds it, and every cut and occlusion test lets it
 * through while it is placed — the CPU and GPU camera cuts (`SPRITE_UNCULLED`), the Hi-Z verdict
 * of its row and of its transparent entries, a blend item's box —. The one
 * test each of them reads.
 */
export const neverCulled = (surface: Pick<VisMaterial, 'sprite'> | undefined) =>
  surface?.sprite?.sizeAttenuation === false

/** The root mark's bit on every sprite (`ClusterRoot.mark`): a sprite casts no shadow, so the
 *  shadow raster leaves its rows out and the sun's scene box leaves it out. */
const SPRITE_ROOT = 1
/** The root mark's bit on a never-culled sprite (`neverCulled`): no camera cut rejects it. */
export const SPRITE_UNCULLED = 2
/** The bits of a root that casts no shadow: what the shadow raster's rows test
 *  (`../../webgpu/shadow/bounds.ts`). */
export const CASTS_NO_SHADOW = SPRITE_ROOT | SHADOWLESS_ROOT
/** The root mark's bit on a root the camera draws as its impostor card (#1335): every camera cut
 *  leaves its clusters to the card (`drawsCard`), the shadow raster still draws them, so the card's
 *  object casts its whole mesh's shadow. */
export const CARD_ROOT = 8
/** Sets or clears `root`'s card bit; true when its mark changed. */
export function markCard(root: { mark?: number }, card: boolean) {
  const before = root.mark ?? 0,
    mark = card ? before | CARD_ROOT : before & ~CARD_ROOT
  root.mark = mark || undefined
  return mark !== before
}
/** `mark` with its shadowless bit set when `shadowless`, cleared otherwise. */
export const withShadowless = (mark: number, shadowless: boolean) =>
  shadowless ? mark | SHADOWLESS_ROOT : mark & ~SHADOWLESS_ROOT
/** Sets or clears `root`'s shadowless bit; true when its mark changed. */
export function markShadowless(root: { mark?: number }, shadowless: boolean) {
  const before = root.mark ?? 0,
    mark = withShadowless(before, shadowless)
  root.mark = mark || undefined
  return mark !== before
}

/**
 * THE SPRITE BITS of a root's mark: what a root carries of its surface, set at collection and
 * carried to every cut — `ClusterRoot.mark`, `DagRoot.mark`, `PackedDag.mark`, then the GPU cut's
 * frame word (`markOf`) — beside its shadowless bit. 0 on any surface that draws no sprite.
 */
export const spriteMark = (surface: Pick<VisMaterial, 'sprite'> | undefined) =>
  !surface?.sprite ? 0 : SPRITE_ROOT | (neverCulled(surface) ? SPRITE_UNCULLED : 0)

/** `SPRITE_WGSL` on the CPU, statement for statement: the software raster's sprite corner. Both
 *  matrices are column-major; writes the point, `w` one, into `out` and returns it. */
export function spriteAt(
  out: Float64Array,
  toClip: ArrayLike<number>,
  place: ArrayLike<number>,
  cornerX: number,
  cornerY: number,
  sprite: NonNullable<VisMaterial['sprite']>,
) {
  let ax = cornerX * hypot3(place[0], place[1], place[2]),
    ay = cornerY * hypot3(place[4], place[5], place[6])
  if (!sprite.sizeAttenuation) {
    const w = toClip[3] * place[12] + toClip[7] * place[13] + toClip[11] * place[14] + toClip[15]
    ax *= w
    ay *= w
  }
  const c = Math.cos(sprite.rotation),
    s = Math.sin(sprite.rotation)
  const r = hypot3(toClip[0], toClip[4], toClip[8]),
    u = hypot3(toClip[1], toClip[5], toClip[9])
  const x = c * ax - s * ay,
    y = s * ax + c * ay
  for (let i = 0; i < 3; i++)
    out[i] = place[12 + i] + (x * toClip[4 * i]) / r + (y * toClip[4 * i + 1]) / u
  out[3] = 1
  return out
}
