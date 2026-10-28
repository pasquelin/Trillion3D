import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts'
import { finishLayout } from '../../post/finish/finishLayout.ts'
import { DISPLAY_FORMAT } from '../../scene/targetFormats.ts'
import type { ComposeInput } from './shaders.ts'
import { makeFullscreenPipeline } from './fullscreen.ts'
import { computeBufferEntry, computeTextureEntry } from '../../gpu/core/computeBindings.ts'
import { toneReadEntries } from '../toneLutRead.ts'
import { CANVAS_FORMAT } from '../../gpu/core/canvasFormat.ts'

const INPUTS = ['asIs', 'flagless'] as const satisfies readonly ComposeInput[]
/** A program's composition texts, one per input — reading a debug view's as-is pixels or none:
 *  plain, and — a lit program's — finishing the image (`../../post/finish/finishWgsl.ts`). */
export type CompositionSources = {
  plain: Record<ComposeInput, string>
  finish?: Record<ComposeInput, string>
  /** Whether the compositions read the tone table (`../toneLut.ts`): the lit program's. */
  lut?: boolean
}

/** Each input's layout: the image and the view, then the surface flags and base colour a debug
 *  view's as-is pixels are read from (`AS_IS_PIXEL`) — none for a flagless frame —, then the tone
 *  table, its sampler and its reading uniform where `lut` says the composition reads them. */
function compositionLayouts(
  device: GPUDevice,
  lut: boolean,
): Record<ComposeInput, GPUBindGroupLayout> {
  const fragment = GPUShaderStage.FRAGMENT
  const layout = (asIs: boolean) =>
    device.createBindGroupLayout({
      entries: [
        computeTextureEntry(0, 'unfilterable-float', '2d', fragment),
        computeBufferEntry(1, 'uniform', fragment),
        ...(asIs
          ? [
              computeTextureEntry(2, 'uint', '2d', fragment),
              computeTextureEntry(3, 'unfilterable-float', '2d', fragment),
            ]
          : []),
        ...(lut ? toneReadEntries(asIs ? 4 : 2, fragment) : []),
      ],
    })
  return { asIs: layout(true), flagless: layout(false) }
}

/** One input's composition: into the capture target, or into it and the canvas at once. */
async function composeInput(
  device: GPUDevice,
  sources: CompositionSources,
  layouts: ReturnType<typeof compositionLayouts>,
  label: string,
  input: ComposeInput,
  finish: boolean,
) {
  const display = { format: DISPLAY_FORMAT }
  const name = `${label}_COMPOSE_${finish ? 'FINISH_' : ''}${input.toUpperCase()}`
  const code = (finish ? sources.finish! : sources.plain)[input]
  const module = await createCheckedShaderModule(device, code, name)
  const groups = finish ? [layouts[input], finishLayout(device)] : layouts[input]
  const [draw, present] = await Promise.all([
    makeFullscreenPipeline(device, module, groups, 'compose', [display]),
    makeFullscreenPipeline(device, module, groups, 'composePresent', [
      display,
      { format: CANVAS_FORMAT },
    ]),
  ])
  // The canvas alone, for a frame whose display colour nothing reads: compiled at the first that
  // asks, and the frame composes both until it has landed.
  let canvas: GPURenderPipeline | undefined, building: Promise<void> | undefined
  return {
    draw,
    present,
    get canvas() {
      building ??= makeFullscreenPipeline(device, module, groups, 'compose', [
        { format: CANVAS_FORMAT },
      ]).then(
        (made) => void (canvas = made),
        () => undefined,
      )
      return canvas
    },
  }
}

/**
 * A program's composition pipelines, one per input (the flagless ones for a frame that holds no
 * as-is pixel): the plain ones, compiled with it, and those that finish the image — its local
 * exposure, the bloom's glow, its vignette —, compiled off the frame at the first that asks for
 * them (`composesFinish`) — a view that finishes nothing never pays for them.
 */
export async function createCompositions(
  device: GPUDevice,
  sources: CompositionSources,
  label: string,
) {
  const layouts = compositionLayouts(device, !!sources.lut)
  const compile = (input: ComposeInput, finish = false) =>
    composeInput(device, sources, layouts, label, input, finish)
  type Pipelines = Awaited<ReturnType<typeof compile>>
  /** Every input's pipelines at once, so a frame switching inputs compiles nothing. */
  const compileAll = async (finish = false) => {
    const [asIs, flagless] = await Promise.all(INPUTS.map((input) => compile(input, finish)))
    return { asIs, flagless }
  }
  const plain = await compileAll()
  let finished: Record<ComposeInput, Pipelines> | undefined, finishing: Promise<void> | undefined
  return {
    /** Each input's layout: the group a frame composes with is made on it. */
    layouts,
    /** True once the pipelines that finish the image are compiled: the first call compiles them,
     *  and `sink` hears why they cannot be, as a failure of the phase
     *  `finish-composition-unavailable`; a program with none of them never composes. Until then
     *  the image is drawn without the finishing. */
    composesFinish(sink: (phase: string, error: unknown) => void) {
      if (!sources.finish) return false
      finishing ??= compileAll(true).then(
        (pipelines) => void (finished = pipelines),
        (error) => sink('finish-composition-unavailable', error),
      )
      return !!finished
    },
    /** The pipelines of `input`, finishing the image once `composesFinish` said they exist. */
    pipelines(input: ComposeInput, finish: boolean): Pipelines {
      if (!finish) return plain[input]
      if (!finished) throw new Error('the finishing compositions are not compiled')
      return finished[input]
    },
  }
}
