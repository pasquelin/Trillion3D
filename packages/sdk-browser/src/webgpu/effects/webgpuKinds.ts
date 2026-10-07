import type { EffectKind } from '../../../../sdk-core/src/world/effect/chain.ts'
import { type EffectPassOf } from '../../effects/targets.ts'
import { createWebgpuBloom } from './webgpuBloom.ts'

/** A pass's last blend left to the composition: the group it reads, at its dynamic offset. */
export type FusedBlend = { group: GPUBindGroup; offset: number }

/** One kind of pass on WebGPU: its programs, compiled once, and the resources its passes share. */
export type WebgpuEffectKind<P> = {
  /** Bytes of what it holds as allocated. */
  readonly bytes: number
  /** Sizes what it holds for `count` passes on a `w × h` image; zero passes free it. */
  resize(w: number, h: number, count: number): void
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
  dispose(): void
}

export type Kinds = { [K in EffectKind]: WebgpuEffectKind<EffectPassOf<K>> }

/** Each kind's WebGPU implementation: the one place a new built-in or a custom pass plugs in. */
export const WEBGPU_KINDS: { [K in EffectKind]: (device: GPUDevice) => Promise<Kinds[K]> } = {
  bloom: createWebgpuBloom,
}
