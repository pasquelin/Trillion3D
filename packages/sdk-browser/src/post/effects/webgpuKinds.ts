import type { EffectKind } from '../../../../sdk-core/src/world/effect/chain.ts'
import { type EffectPassOf } from './targets.ts'
import type { RootsOwner } from '../../frame/render/movedNode.ts'
import type { FrameRevisions } from '../../frame/revisions.ts'
import { createWebgpuBloom } from './webgpuBloom.ts'
import { createWebgpuOutline } from './webgpuOutline.ts'

/** A pass's last blend left to the composition: the group it reads, at its dynamic offset. */
export type FusedBlend = { group: GPUBindGroup; offset: number }

/** What every kind of pass holds on WebGPU, whatever its stage. */
type KindResources = {
  /** Bytes of what it holds as allocated. */
  readonly bytes: number
  /** Sizes what it holds for `count` passes on a `w × h` image; zero passes free it. */
  resize(w: number, h: number, count: number): void
  dispose(): void
}

/** One kind of pass on WebGPU that runs before tone mapping: its programs, compiled once, and the
 *  resources its passes share. */
export type WebgpuEffectKind<P> = KindResources & {
  /** Encodes `pass`, the `nth` of its kind in the chain, from `input` into `output`, or with no
   *  `output` leaves its last blend to the composition (`blend`); returns the render passes
   *  encoded, zero when it cannot draw at this size. */
  encode(
    encoder: GPUCommandEncoder,
    pass: P,
    nth: number,
    input: GPUTextureView,
    output: GPUTextureView | undefined,
  ): number
  /** The blend the last `encode` left to the composition, if it did: a kind without it never
   *  leaves one, and is always handed an output. */
  readonly blend?: FusedBlend
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

/** Where a kind's passes run: over the linear image before tone mapping, or over the display
 *  image after it. */
type WebgpuStage = 'hdr' | 'overlay'

/** A kind's implementation, as its stage asks. */
type KindOf<P> = P extends { stage: 'after-tone-mapping' }
  ? WebgpuOverlayKind<P>
  : WebgpuEffectKind<P>

export type Kinds = { [K in EffectKind]: KindOf<EffectPassOf<K>> }

/** The stage a kind's implementation draws at, as its type says. */
type StageOf<K extends EffectKind> = Kinds[K] extends WebgpuOverlayKind<never> ? 'overlay' : 'hdr'

/** Each kind's WebGPU implementation and the stage it draws at: the one place a new built-in or a
 *  custom pass plugs in. */
export const WEBGPU_KINDS: {
  [K in EffectKind]: {
    readonly stage: StageOf<K>
    create: (device: GPUDevice) => Promise<Kinds[K]>
  }
} = {
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

/** The kinds that run before tone mapping. */
export const HDR_KINDS: readonly KindsAt<'hdr'>[] = kindsAt('hdr')
/** The kinds drawn over the display image. */
export const OVERLAY_KINDS: readonly KindsAt<'overlay'>[] = kindsAt('overlay')
