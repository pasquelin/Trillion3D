import { sequentialEntries } from '../../gpu/core/computeBindings.ts'
import type { SurfaceBuffer } from '../../materials/surface/surfaceBuffer.ts'
import { createCompositions, type CompositionSources } from './compositions.ts'
import type { ComposeInput } from './shaders.ts'
import type { ComposedImage, DeferredBindings } from './program.ts'

/** A composition: its group, and the input its pipelines compose (`compositions`). */
type Composition = { group: GPUBindGroup; input: ComposeInput }
/** A composition kept under its colour and flags, with the base colour its group binds: a base made
 *  again under the same flags makes the group again. */
type Kept = { composition: Composition; base: GPUTextureView | undefined }

/**
 * THE COMPOSITION OF THE LIT IMAGE: its pipelines (`createCompositions`) and the bind groups they
 * read the image through. A group reads the lit image or the image composed from it, the surface
 * flags and base colour a debug view's as-is pixels are drawn from (`AS_IS_PIXEL`), and, for a lit
 * chain, the tone table, its sampler and its reading uniform. They are kept weakly keyed by every
 * view they read, and made again when the tone table's texture is another. `bind` names the image
 * and the surface the frame lights; a frame that composes before any is bound composes nothing.
 */
export async function createComposer(
  device: GPUDevice,
  sources: CompositionSources,
  bindings: DeferredBindings,
  label: string,
) {
  const compositions = await createCompositions(device, sources, label)
  let surface: SurfaceBuffer | undefined,
    hdr: GPUTextureView | undefined,
    flags: GPUTextureView | undefined,
    base: GPUTextureView | undefined,
    toneView: GPUTextureView | undefined,
    composed = new WeakMap<GPUTextureView, WeakMap<GPUTextureView, Kept>>()
  return {
    compositions,
    /** The lit image and the surface it was lit from. */
    bind(next: SurfaceBuffer, image: GPUTextureView) {
      surface = next
      hdr = image
      const views = next.views()
      base = views[0]
      flags = views[3]
    },
    /** The group reading the lit image, or `image`, with the surface's flags and base colour, and
     *  the input its pipelines compose (`compositions`); `undefined` before `bind`. A frame that
     *  holds no as-is pixel (`asIs` false) binds the colour alone. */
    composition(image?: ComposedImage, asIs = true) {
      const view = image?.color ?? hdr,
        // The flagless group is kept under its colour: no flags view is ever a colour one.
        key = asIs ? flags : view
      if (!view || !key || !surface) return undefined
      const tone = sources.lut ? bindings.tone : undefined
      if (sources.lut && !tone) throw new Error('TONE_TABLE_UNAVAILABLE')
      const table = tone?.view()
      if (table !== toneView) {
        toneView = table
        composed = new WeakMap()
      }
      let byFlags = composed.get(view)
      if (!byFlags) composed.set(view, (byFlags = new WeakMap()))
      const kept = byFlags.get(key)
      if (kept && (!asIs || kept.base === base)) return kept.composition
      const input = asIs ? 'asIs' : 'flagless'
      const entries = sequentialEntries([
        view,
        { buffer: bindings.uniform },
        ...(asIs ? [flags!, base!] : []),
        ...(tone ? [table!, tone.sampler, { buffer: tone.reading }] : []),
      ])
      const group = device.createBindGroup({ layout: compositions.layouts[input], entries })
      const composition = { group, input } as const
      byFlags.set(key, { composition, base })
      return composition
    },
    release() {
      surface = hdr = flags = base = toneView = undefined
      composed = new WeakMap()
    },
  }
}

/** The composition of a lit image. */
export type Composer = Awaited<ReturnType<typeof createComposer>>
