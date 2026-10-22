import type { EffectKind } from '../../../../sdk-core/src/world/effect/chain.ts'
import type { DepthOfFieldValues } from '../../../../sdk-core/src/contracts/depthOfFieldRules.ts'
import type { BloomValues } from '../../../../sdk-core/src/contracts/bloomRules.ts'
import type { MotionBlurValues } from '../../../../sdk-core/src/contracts/motionBlurOptions.ts'
import { type EffectPassOf } from './targets.ts'
import type { RootsOwner } from '../../frame/render/movedNode.ts'
import type { FrameRevisions } from '../../frame/revisions.ts'
import type { PostFrame } from '../finish/finish.ts'
import { createWebgpuBloom } from './webgpuBloom.ts'
import { createWebgpuDepthOfField } from './webgpuDepthOfField.ts'
import { createWebgpuMotionBlur } from './webgpuMotionBlur.ts'
import { createWebgpuOutline } from './webgpuOutline.ts'

/** What a pass left to the composition: the glow it drew, which the composition adds to the image
 *  it reads. */
export type FusedBlend = { glow: GPUTextureView }

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
 *  resources its passes share. */
export type WebgpuEffectKind<P> = KindResources & {
  /** Encodes `pass`, the `nth` of its kind in the chain, from `input` into `output`, or with no
   *  `output` leaves its last blend to the composition (`blend`); returns the render passes
   *  encoded, zero when it has nothing to draw. `post` is what the frame's passes share
   *  (`../finish/finish.ts`); `bloom` how the view draws the bloom (`BLOOM_RULES`), the defaults
   *  where the frame names none. */
  encode(
    encoder: GPUCommandEncoder,
    pass: P,
    nth: number,
    input: GPUTextureView,
    output: GPUTextureView | undefined,
    post: PostFrame,
    bloom?: BloomValues,
  ): number
  /** The blend the last `encode` left to the composition, if it did: a kind without it never
   *  leaves one, and is always handed an output. */
  readonly blend?: FusedBlend
}

/** What the frame offers a pass drawn on the image the temporal pass resolved. */
export type ResolveFrame = {
  /** The size of the image, in its pixels. */
  size: readonly number[]
  /** The size of the textures the image lies in, its top-left: its own where it is the resolved
   *  one, the largest a frame is drawn at where it is the lit one, drawn below it. The images a
   *  pass writes are made at it. */
  extent: readonly number[]
  /** The grid the motion of its texels was measured on, this image's render grid. */
  render: readonly number[]
  /** The size the targets the motion was measured on were made at, the largest grid a frame is
   *  drawn on. */
  allocated: readonly number[]
  /** Each render texel's reprojection vector, the velocity stage's (`../taa/velocity.ts`). */
  vectors: GPUTextureView
  /** The depth the image was drawn with. */
  depth: GPUTextureView
  /** The uniform the motion was measured with (`TAA_VIEW`): the matrices, the render grid, whether
   *  the history describes the image. */
  view: GPUBuffer
  /** How the blur is drawn (`MOTION_BLUR_RULES`), as the view's settings resolve this image. */
  settings: MotionBlurValues
  /** How the depth of field is drawn (`DEPTH_OF_FIELD_RULES`), as the view's settings resolve it. */
  depthOfField: DepthOfFieldValues
  /** The camera the image was drawn with: its projection, column-major, whether it is a perspective
   *  one, its nearest distance drawn and the exposure the image is shown at. */
  camera: { projection: ArrayLike<number>; perspective: boolean; near: number; exposure: number }
  /** When the image is drawn, ms: the motion is its change since the one drawn before. */
  now: number
  /** Whether the image shows what the one before did: no motion, so nothing to blur (the stage's
   *  `still`). */
  still: boolean
}

/** One kind of pass on WebGPU that runs on the image the temporal pass resolved, before anything
 *  else reads it: the programs and the targets its passes share. */
export type WebgpuResolveKind<P> = KindResources & {
  /** Draws `pass`, the `nth` of its kind in the chain, over `input`, the resolved image or the
   *  one the pass before left; returns the image after it, `input` itself when it drew nothing. */
  resolve(
    encoder: GPUCommandEncoder,
    pass: P,
    nth: number,
    input: GPUTextureView,
    frame: ResolveFrame,
  ): GPUTextureView
  /** The render and compute passes the last `resolve` encoded. */
  readonly passes: number
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

/** Where a kind's passes run: on the resolved image, over the linear image before tone mapping,
 *  or over the display image after it. */
type WebgpuStage = 'resolve' | 'hdr' | 'overlay'

/** A kind's implementation, as its stage asks. */
type KindOf<P> = P extends { stage: 'after-resolve' }
  ? WebgpuResolveKind<P>
  : P extends { stage: 'after-tone-mapping' }
    ? WebgpuOverlayKind<P>
    : WebgpuEffectKind<P>

export type Kinds = { [K in EffectKind]: KindOf<EffectPassOf<K>> }

/** The stage a kind's implementation draws at, as its type says. */
type StageOf<K extends EffectKind> =
  Kinds[K] extends WebgpuResolveKind<never>
    ? 'resolve'
    : Kinds[K] extends WebgpuOverlayKind<never>
      ? 'overlay'
      : 'hdr'

/** Each kind's WebGPU implementation and the stage it draws at: the one place a new built-in or a
 *  custom pass plugs in. */
export const WEBGPU_KINDS: {
  [K in EffectKind]: {
    readonly stage: StageOf<K>
    create: (device: GPUDevice, fail: (error: unknown) => void) => Promise<Kinds[K]>
  }
} = {
  depthOfField: { stage: 'resolve', create: createWebgpuDepthOfField },
  motionBlur: { stage: 'resolve', create: createWebgpuMotionBlur },
  bloom: { stage: 'hdr', create: createWebgpuBloom },
  outline: { stage: 'overlay', create: createWebgpuOutline },
}

/** The kinds drawn at `stage`. */
type KindsAt<S extends WebgpuStage> = {
  [K in EffectKind]: StageOf<K> extends S ? K : never
}[EffectKind]

/** The kinds drawn at `stage`, read off the table. */
const kindsAt = <S extends WebgpuStage>(stage: S) =>
  (Object.keys(WEBGPU_KINDS) as EffectKind[]).filter(
    (kind): kind is KindsAt<S> => WEBGPU_KINDS[kind].stage === stage,
  )

/** The kinds that run on the resolved image. */
export const RESOLVE_KINDS: readonly KindsAt<'resolve'>[] = kindsAt('resolve')
/** The kinds that run before tone mapping. */
export const HDR_KINDS: readonly KindsAt<'hdr'>[] = kindsAt('hdr')
/** The kinds drawn over the display image. */
export const OVERLAY_KINDS: readonly KindsAt<'overlay'>[] = kindsAt('overlay')
