import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts'
import { finishLayout } from '../../post/finish/finishLayout.ts'
import { DISPLAY_FORMAT } from '../../scene/targetFormats.ts'
import type { ComposeInput } from './shaders.ts'
import { makeFullscreenPipeline } from './fullscreen.ts'
import { computeBufferEntry, computeTextureEntry } from '../../gpu/core/computeBindings.ts'

const INPUTS = ['still', 'accumulated', 'flagless'] as const satisfies readonly ComposeInput[]
/** A program's composition texts, one per input it reads the as-is share from (`AS_IS_READ`):
 *  plain, and — a lit program's — finishing the image (`../../post/finish/finishWgsl.ts`). */
export type CompositionSources = {
  plain: Record<ComposeInput, string>
  finish?: Record<ComposeInput, string>
}

/** Each input's layout: the image and the view, then the share read beside them — none for a
 *  flagless frame. */
function compositionLayouts(device: GPUDevice): Record<ComposeInput, GPUBindGroupLayout> {
  const fragment = GPUShaderStage.FRAGMENT
  const layout = (share?: GPUTextureSampleType) =>
    device.createBindGroupLayout({
      entries: [
        computeTextureEntry(0, 'unfilterable-float', '2d', fragment),
        computeBufferEntry(1, 'uniform', fragment),
        ...(share ? [computeTextureEntry(2, share, '2d', fragment)] : []),
      ],
    })
  return { still: layout('uint'), accumulated: layout('unfilterable-float'), flagless: layout() }
}

/**
 * A program's composition pipelines, one per input (the flagless ones for a frame that reads no
 * as-is share): the plain ones, compiled with it, and those that finish the image — its local
 * exposure, the bloom's glow, its vignette —, compiled off the frame at the first that asks for
 * them (`composesFinish`) — a view that finishes nothing never pays for them.
 */
export async function createCompositions(
  device: GPUDevice,
  sources: CompositionSources,
  label: string,
) {
  const layouts = compositionLayouts(device)
  const display = { format: DISPLAY_FORMAT }
  /** One input's composition: into the capture target, or into it and the canvas at once. */
  const compile = async (input: ComposeInput, finish = false) => {
    const name = `${label}_COMPOSE_${finish ? 'FINISH_' : ''}${input.toUpperCase()}`
    const code = (finish ? sources.finish! : sources.plain)[input]
    const module = await createCheckedShaderModule(device, code, name)
    const groups = finish ? [layouts[input], finishLayout(device)] : layouts[input]
    const [draw, present] = await Promise.all([
      makeFullscreenPipeline(device, module, groups, 'compose', [display]),
      makeFullscreenPipeline(device, module, groups, 'composePresent', [
        display,
        { format: 'bgra8unorm' },
      ]),
    ])
    return { draw, present }
  }
  type Pipelines = Awaited<ReturnType<typeof compile>>
  /** Every input's pipelines at once, so a frame switching inputs compiles nothing. */
  const compileAll = async (finish = false) => {
    const [still, accumulated, flagless] = await Promise.all(
      INPUTS.map((input) => compile(input, finish)),
    )
    return { still, accumulated, flagless }
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
