import type { EffectKind } from '../../../../sdk-core/src/world/effect/chain.ts'
import { type EffectPassOf } from './targets.ts'
import type { ValuesOf } from './kindRules.ts'
import type { RootsOwner } from '../../frame/render/movedNode.ts'
import type { FrameRevisions } from '../../frame/revisions.ts'
import type { PostFrame } from '../finish/finish.ts'
import { createWebgpuBloom } from './webgpuBloom.ts'
import { createWebgpuDepthOfField } from './webgpuDepthOfField.ts'
import { createWebgpuMotionBlur } from './webgpuMotionBlur.ts'
import { createWebgpuOutline } from './webgpuOutline.ts'
import type { FusedFlatten } from './motionBlur/motionBlurLayout.ts'

/** What a pass left to the composition: the glow it drew, which the composition adds to the image
 *  it reads where it applies the exposure — the glow times `1 + mask × factor` where a dirt mask
 *  is drawn (`mask`, the picture read at the level the image's size asks, none for no mask), the
 *  image's own colour times `keep` where the glow took some of its light (`keeps`). Rewritten by
 *  each image the pass draws: an image allocates none. */
export type FusedBlend = {
  glow: GPUTextureView
  keeps: boolean
  keep: number[]
  mask: GPUTextureView | undefined
  factor: number[]
}

/** What every kind of pass holds on WebGPU, whatever its stage. */
type KindResources = {
  /** Bytes of what it holds as allocated. */
  readonly bytes: number
  /** The compile of programs it was asked for after it was made, while it runs: the image drawn
   *  meanwhile lacks what they give, and is drawn again once they arrive. None where it has none. */
  readonly arriving?: Promise<void>
  /** Sizes what it holds for `count` passes on a `w × h` image; zero passes free it. */
  resize(w: number, h: number, count: number): void
  dispose(): void
}

/** One kind of pass on WebGPU that runs before tone mapping: its programs, compiled once, and the
 *  resources its passes share. `V` is what the view's settings of the kind resolve to. */
export type WebgpuEffectKind<P, V = undefined> = KindResources & {
  /** Encodes `pass`, the `nth` of its kind in the chain, from `input` into `output`, or with no
   *  `output` leaves its last blend to the composition (`blend`); returns the render passes
   *  encoded, zero when it has nothing to draw. `post` is what the frame's passes share
   *  (`../finish/finish.ts`); `settings` how the view draws the kind (`KIND_RULES[kind].settings`),
   *  its defaults where the frame names no session. */
  encode(
    encoder: GPUCommandEncoder,
    pass: P,
    nth: number,
    input: GPUTextureView,
    output: GPUTextureView | undefined,
    post: PostFrame,
    settings: V,
  ): number
  /** The blend the last `encode` left to the composition, if it did: a kind without it never
   *  leaves one, and is always handed an output. */
  readonly blend?: FusedBlend
}

/** What the passes before the temporal pass know of its accumulation: whether the image is accumulated in
 *  time, so each pass may stabilise what it makes from the motion measured, whether its history
 *  describes nothing (a cut), the image's jitter in render pixels — the shift the render grid's
 *  samples were drawn at, `y` down — and the frame's rank among eight, which the noise of a pass turns by. */
export type ResolveTemporal = {
  active: boolean
  cut: boolean
  jitter: readonly [number, number]
  slot: number
}

/** What the frame offers a pass drawn on the lit image before the temporal pass, or on the image the
 *  temporal pass resolved. */
export type ResolveFrame = {
  /** The size of the image, in its pixels. */
  size: readonly number[]
  /** The size of the textures the image lies in, its top-left: its own where it is the resolved
   *  one, the largest a frame is drawn at where it is the lit one, drawn below it. The images a
   *  pass writes are made at it. */
  extent: readonly number[]
  /** The display's size: the image the temporal pass resolves, which it rebuilds the lit one to. */
  display: readonly number[]
  /** The grid the motion of its texels was measured on, this image's render grid. */
  render: readonly number[]
  /** The size the targets the motion was measured on were made at, the largest grid a frame is
   *  drawn on. Like `vectors`, `view` and `still`, set where the velocity stage measured the image —
   *  the passes that read them are asked for nothing else (`KIND_RULES[kind].motion`, `temporal.active`). */
  allocated: readonly number[]
  /** Each render texel's reprojection vector, the velocity stage's (`../taa/velocity.ts`). */
  vectors: GPUTextureView
  /** The depth the image was drawn with. */
  depth: GPUTextureView
  /** The uniform the motion was measured with (`TAA_VIEW`): the matrices, the render grid, whether
   *  the history describes the image. */
  view: GPUBuffer
  /** The session's settings the kinds' own are read from (`KIND_RULES[kind].settings`): none, the
   *  kinds are handed their defaults. */
  session: object | undefined
  /** The temporal pass's accumulation of the image (`ResolveTemporal`). */
  temporal: ResolveTemporal
  /** The camera the image was drawn with: its projection, column-major, whether it is a perspective
   *  one, its nearest distance drawn and the exposure the image is shown at. */
  camera: { projection: ArrayLike<number>; perspective: boolean; near: number; exposure: number }
  /** When the image is drawn, ms: the motion is its change since the one drawn before. */
  now: number
  /** Whether the image shows what the one before did: no motion, so nothing to blur (the stage's
   *  `still`). */
  still: boolean
  /** Whether the image is the temporal pass's, which makes the half-size copy of it the motion blur's
   *  samples may read (`motionBlurHalfResInput`); an image the pass did not resolve has none. */
  resolved: boolean
  /** Where the temporal pass's nearest velocity flattened the motion blur's motion for this image,
   *  when the blur asked for it (`WebgpuResolveKind.fuse`); none, the blur flattens its own. */
  flatten: FusedFlatten | undefined
  /** Whether the passes that write the half-size image beside their own do it, the quality asking
   *  the chain's own pass for it otherwise (`temporalDownsampleQuality`); not told, they do. */
  halfBeside?: boolean
  /** The group of the translucency the lit image is composed with (`blend/translucencyLayers.ts`),
   *  where layers are drawn for it: the last depth of field composes it in its recombine
   *  (`layersComposed`). None on the resolved image, and where the image has none. */
  layers?: GPUBindGroup
  /** Set by the pass that composed `layers`. */
  layersComposed?: boolean
  /** On the resolved image, the translucency drawn after the motion blur, where there is some: its
   *  group (`blend/translucencyLayers.ts`) and the size of its textures. The last motion blur lays
   *  it over its image (`lateComposed`). */
  lateLayers?: { group: GPUBindGroup; extent: readonly number[] }
  /** Set by the pass that laid `lateLayers`. */
  lateComposed?: boolean
}

/** One kind of pass on WebGPU that runs on the lit image before the temporal pass, or on the image it
 *  resolved, before anything else reads it: the programs and the targets its passes share. `V` is what
 *  the view's settings of the kind resolve to. */
export type WebgpuResolveKind<P, V = undefined> = KindResources & {
  /** Draws `pass`, the `nth` of its kind in the chain, over `input`, the image the stage was handed or
   *  the one the pass before left; returns the image after it, `input` itself when it drew nothing.
   *  `settings` is how the view draws the kind (`KIND_RULES[kind].settings`), its defaults where the
   *  frame names no session. */
  resolve(
    encoder: GPUCommandEncoder,
    pass: P,
    nth: number,
    input: GPUTextureView,
    frame: ResolveFrame,
    settings: V,
  ): GPUTextureView
  /** The render and compute passes the last `resolve` encoded. */
  readonly passes: number
  /** For a kind that writes the half-size image of the image it leaves, as it writes the image
   *  (`motionBlur/filterWgsl.ts`): that image of the last `resolve`, none where it wrote none or
   *  drew nothing. The scene's chain reads it in place of the pass that draws it
   *  (`../filters/sceneChain.ts`). */
  readonly half?: GPUTextureView
  /** For a kind whose motion the temporal pass's nearest velocity can flatten as it dilates it: sets
   *  the first `pass` of the kind up for this image, ahead of the temporal pass, and returns what that
   *  dispatch is to write (`FusedFlatten`) — none where the image takes the kind's own way: the
   *  kind's `resolve` then finds the flattening done (`ResolveFrame.flatten`). */
  fuse?(pass: P, frame: ResolveFrame, settings: V): FusedFlatten | undefined
}

/** What the frame offers a pass drawn over its display image: the image and the canvas it was
 *  presented to, the visibility identifiers it was drawn from, and the roots they name. */
export type OverlayFrame = {
  /** The composed display colour (`DISPLAY_FORMAT`), drawn over in place. */
  display: GPUTextureView
  /** The canvas the composition presented to, drawn over the same; none when it composed
   *  offscreen. */
  presentation: GPUTextureView | undefined
  /** The display's size, in its pixels. */
  size: readonly [number, number]
  /** Display pixels per CSS pixel. */
  pixelRatio: number
  /** The visibility identifiers (`visibility/visWords.ts`), at the render size. */
  ids: GPUTextureView
  /** The size the identifiers were drawn at, in their texels: the top-left of their target. */
  idSize: readonly [number, number]
  /** The page table the identifiers name rows of; each row names its placement. */
  pages: GPUBuffer
  /** The placements' roots, which a row's placement ranks, and their index by node. */
  layout: RootsOwner
  /** The view-projection the image was drawn with, column-major. */
  viewProj: ArrayLike<number>
  /** The frame's revisions (`../../frame/revisions.ts`): what a pass keeps from frame to frame is
   *  taken again only when the one it reads moved. */
  revisions: FrameRevisions
}

/** One kind of pass on WebGPU that runs after tone mapping, drawn over the display image. */
export type WebgpuOverlayKind<P> = KindResources & {
  /** Draws `pass`, the `nth` of its kind in the chain, over `frame`'s display image; returns the
   *  render passes encoded. */
  overlay(encoder: GPUCommandEncoder, pass: P, nth: number, frame: OverlayFrame): number
}

/** A kind's implementation, as its stage asks. */
type KindOf<P, V> = P extends { stage: 'before-resolve' | 'after-resolve' }
  ? WebgpuResolveKind<P, V>
  : P extends { stage: 'after-tone-mapping' }
    ? WebgpuOverlayKind<P>
    : WebgpuEffectKind<P, V>

export type Kinds = { [K in EffectKind]: KindOf<EffectPassOf<K>, ValuesOf<K>> }

/** Each kind's WebGPU implementation: the one place a new built-in or a custom pass plugs in its code
 *  (its stage, bytes and settings are in `KIND_RULES`, which the frame's entry reads before it arrives). */
export const WEBGPU_KINDS: {
  [K in EffectKind]: {
    create: (device: GPUDevice, fail: (error: unknown) => void) => Promise<Kinds[K]>
  }
} = {
  depthOfField: { create: createWebgpuDepthOfField },
  motionBlur: { create: createWebgpuMotionBlur },
  bloom: { create: createWebgpuBloom },
  outline: { create: createWebgpuOutline },
}
