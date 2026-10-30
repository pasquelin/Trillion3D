import { chainReady } from '../deferred/fullscreen.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { copyMatrix4 } from '../../../../math/src/matrix/matrix4.ts'
import {
  computeSamplerEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../gpu/core/computeBindings.ts'
import { dispatchOn, layoutStagesOf } from '../../gpu/core/computeStages.ts'
import { putVec4 } from '../../gpu/core/fieldLayout.ts'
import { standInTexture } from '../../gpu/core/standIns.ts'
import { uniformBlock } from '../../gpu/core/uniformBlock.ts'
import { FOG_TEMPORAL_PASS } from '../../diagnostic/stage/passLabels.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import { historyFormatsOf } from '../../post/taa/historyShape.ts'
import {
  fogTemporalWgsl,
  TEMPORAL_BINDINGS as T,
  TEMPORAL_ENTRY,
  TEMPORAL_GROUP,
  TEMPORAL_LAYOUT,
} from './separateTemporalWgsl.ts'

/**
 * THE TEMPORAL FILTER OF THE FOG TEXTURE'S SECOND LEVEL: when the screen-space scattering asks for it,
 * the colour texture's first level is filtered in time by a history of its own — the camera's motion
 * from the depth, the history held to the box of the pixel and its neighbours, a share of the new
 * image toward a fixed one by the motion — and the result, averaged 2 by 2, is the texture's second
 * level, the blur chain going on from the third (`separate.ts`). The history is kept in the format the
 * temporal pass keeps its own in (`historyFormatsOf`), two textures taking turns.
 */

/** What an image tells the filter. */
export interface TemporalInput {
  /** The clip positions of this image in the last image's. */
  readonly clipToPrevClip: ArrayLike<number>
  /** The weight of the new image in the blend. */
  readonly currentWeight: number
  /** The exposure the image is shown at, and the pre-exposure it holds its light under. */
  readonly shown: number
  readonly preExposure: number
  /** Whether the history is dropped: a camera cut, or an image the history did not follow. */
  readonly cut: boolean
  /** The image's slot among eight, which the dither follows. */
  readonly slot: number
  /** The scene's depth and the vectors (the flags of the surface in green), none where it has none. */
  readonly depth: GPUTextureView
  readonly vectors: GPUTextureView | undefined
  /** Whether the packed history format is wanted where the device stores to it. */
  readonly packed: boolean
}

/** The filter of a device: its stages by the history format, made off the frame, and the history. */
export function createFogTemporalGpu(device: GPUDevice, failed: (error: unknown) => void) {
  const block = uniformBlock(device, FOG_TEMPORAL_PASS, TEMPORAL_LAYOUT.words * 4)
  const at = TEMPORAL_LAYOUT.at
  const sampler = device.createSampler({
    label: FOG_TEMPORAL_PASS,
    magFilter: 'linear',
    minFilter: 'linear',
  })
  const noVectors = standInTexture(device, FOG_TEMPORAL_PASS, 'rg32uint')
  const noVectorsView = noVectors.createView()
  const stages = new Map<GPUTextureFormat, ReturnType<typeof stageFor>>()
  const makeStage = layoutStagesOf(device, FOG_TEMPORAL_PASS)
  function stageFor(format: GPUTextureFormat) {
    const module = device.createShaderModule({
      label: FOG_TEMPORAL_PASS,
      code: fogTemporalWgsl(format),
    })
    const stage = makeStage(format, module, TEMPORAL_ENTRY, [
      computeUniformEntry(T.uniform),
      computeTextureEntry(T.colour, 'float'),
      computeTextureEntry(T.depth, 'depth'),
      computeTextureEntry(T.vectors, 'uint'),
      computeTextureEntry(T.history, 'float'),
      computeSamplerEntry(T.sampler, 'filtering'),
      computeStorageTextureEntry(T.historyOut, format),
      computeStorageTextureEntry(T.levelOut, HDR_FORMAT),
    ])
    stage.pipeline.prepare().catch(failed)
    return stage
  }
  const formatOf = (packed: boolean) =>
    historyFormatsOf(device.features, packed, device.limits).color
  const stageOf = (format: GPUTextureFormat) => {
    let made = stages.get(format)
    if (!made) stages.set(format, (made = stageFor(format)))
    return made
  }

  let history:
    | {
        textures: [GPUTexture, GPUTexture]
        views: [GPUTextureView, GPUTextureView]
        format: GPUTextureFormat
        width: number
        height: number
      }
    | undefined
  let turn = 0
  // The pre-exposure the history was written under; none before it holds an image.
  let writtenUnder = 0
  // The rect the last image drew in the history.
  let drawnBefore: readonly [number, number] = [1, 1]
  // The groups by turn, kept while the views they bind are the image's.
  const groups: (
    { layout: GPUBindGroupLayout; views: GPUTextureView[]; group: GPUBindGroup } | undefined
  )[] = [undefined, undefined]

  /** Lets go of the history (the next image starts it again). */
  function release() {
    if (history) for (const texture of history.textures) retire(device, texture)
    history = undefined
    writtenUnder = 0
    groups.fill(undefined)
  }

  /** The group of the turn, made again where a view it binds changed. */
  function groupOf(layout: GPUBindGroupLayout, views: GPUTextureView[]) {
    const kept = groups[turn]
    if (kept && kept.layout === layout && kept.views.every((view, at) => view === views[at]))
      return kept.group
    const [colour, depth, vectors, past, now, level] = views
    const group = device.createBindGroup({
      label: FOG_TEMPORAL_PASS,
      layout,
      entries: [
        { binding: T.uniform, resource: { buffer: block.buffer } },
        { binding: T.colour, resource: colour },
        { binding: T.depth, resource: depth },
        { binding: T.vectors, resource: vectors },
        { binding: T.history, resource: past },
        { binding: T.sampler, resource: sampler },
        { binding: T.historyOut, resource: now },
        { binding: T.levelOut, resource: level },
      ],
    })
    groups[turn] = { layout, views, group }
    return group
  }

  function historyFor(format: GPUTextureFormat, width: number, height: number) {
    if (
      history &&
      history.format === format &&
      history.width === width &&
      history.height === height
    )
      return history
    release()
    const make = () =>
      device.createTexture({
        label: FOG_TEMPORAL_PASS,
        size: [width, height],
        format,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
      })
    const textures: [GPUTexture, GPUTexture] = [make(), make()]
    const views: [GPUTextureView, GPUTextureView] = [
      textures[0].createView(),
      textures[1].createView(),
    ]
    return (history = { textures, views, format, width, height })
  }

  return {
    /** Whether the stage of the history format `input` asks is compiled, asked now otherwise. */
    ready: (packed: boolean) => chainReady(stageOf(formatOf(packed)).pipeline),
    /** Bytes of the history. */
    get bytes() {
      return history
        ? history.width * history.height * 2 * (history.format === 'rg11b10ufloat' ? 4 : 8)
        : 0
    },
    /** Lets go of the history, where the filter does not run. */
    release,
    /**
     * Filters `colour` (the first level of a texture of the size `allocated`, of which the rect `drawn` is the image) into
     * `level` (its second), keeping the result as the history of the next image, which the size of the rect drawn does not cut.
     */
    run(
      encoder: GPUCommandEncoder,
      colour: GPUTextureView,
      level: GPUTextureView,
      allocated: { readonly width: number; readonly height: number },
      drawn: { readonly width: number; readonly height: number },
      input: TemporalInput,
    ) {
      const format = formatOf(input.packed)
      const stage = stageOf(format)
      const fresh =
        !history ||
        history.width !== allocated.width ||
        history.height !== allocated.height ||
        history.format !== format
      const held = historyFor(format, allocated.width, allocated.height)
      const { width, height } = drawn
      const f = block.words.f
      copyMatrix4(f, input.clipToPrevClip, at.clipToPrevClip)
      putVec4(f, at.size, width, height, 1 / width, 1 / height)
      putVec4(
        f,
        at.history,
        allocated.width,
        allocated.height,
        fresh ? width : drawnBefore[0],
        fresh ? height : drawnBefore[1],
      )
      putVec4(
        f,
        at.params,
        input.currentWeight,
        input.shown,
        writtenUnder > 0 ? input.preExposure / writtenUnder : 1,
        input.cut || fresh ? 1 : 0,
      )
      putVec4(block.words.u, at.frame, input.slot)
      block.send()
      const group = groupOf(stage.layout, [
        colour,
        input.depth,
        input.vectors ?? noVectorsView,
        held.views[turn],
        held.views[1 - turn],
        level,
      ])
      const pass = encoder.beginComputePass({ label: FOG_TEMPORAL_PASS })
      dispatchOn(
        pass,
        stage.pipeline,
        group,
        ceilDiv(width, TEMPORAL_GROUP),
        ceilDiv(height, TEMPORAL_GROUP),
      )
      pass.end()
      turn = 1 - turn
      drawnBefore = [width, height]
      writtenUnder = input.preExposure
    },
    dispose() {
      release()
      noVectors.destroy()
      block.buffer.destroy()
    },
  }
}

/** The fog texture's temporal filter of a device. */
export type FogTemporalGpu = ReturnType<typeof createFogTemporalGpu>
