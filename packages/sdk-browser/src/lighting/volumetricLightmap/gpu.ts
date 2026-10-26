import { postSamplers } from '../../gpu/core/postSamplers.ts'
import {
  layoutDimensions,
  paddedBrickSide,
  type VolumetricLightmapCell,
  type VolumetricLightmapCellData,
  type VolumetricLightmapData,
} from '../../../../sdk-core/src/lighting/volumetricLightmapFile.ts'
import { bricksOf, brickBytes, createCellStreamer } from './cells.ts'
import { createVolumetricLightmapTextures, volumetricLightmapGroupEntries } from './textures.ts'
import { VOLUMETRIC_LIGHTMAP_VIEW_WORDS, writeVolumetricLightmapView } from './view.ts'

/** What streams the finest bricks into a lightmap: the reader of a cell, the memory in megabytes the
 *  loaded bricks may take, and what is told of a cell that fails or does not fit. */
export interface CellStreaming {
  readonly read: (
    cell: VolumetricLightmapCell,
    signal: AbortSignal,
  ) => Promise<VolumetricLightmapCellData>
  readonly memoryMb: number
  readonly report: (code: string, detail?: unknown) => void
}

/**
 * THE VOLUMETRIC LIGHTMAP ON THE GPU, made once for a session's lightmap and kept for its life: the
 * nine textures (`textures.ts`), the bilinear sampler they are read through, and the view block that
 * finds a position in them (`view.ts`), written shown. A lightmap with cells (`cells.ts`) has its
 * atlas made with room for the bricks they bring, as many as `memoryMb` holds at most, and a
 * streamer that fills it (`update`). Whether the lightmap is read is the `volumetricLightmap`
 * setting's, which the passes that read it ask (`frame.ts`), not the resources'.
 */
export function createVolumetricLightmapGpu(
  device: GPUDevice,
  data: VolumetricLightmapData,
  streaming?: CellStreaming,
) {
  const total = data.cells ? data.cells.list.reduce((sum, cell) => sum + cell.bricks, 0) : 0
  const room = streaming
    ? Math.min(total, Math.floor((streaming.memoryMb * 2 ** 20) / brickBytes(data)))
    : 0
  const base = room ? bricksOf(data) : 0
  const layout = layoutDimensions(base + room)
  const atlas = room
    ? (layout.map((n) => n * paddedBrickSide(data.brickSize)) as [number, number, number])
    : data.atlasSize
  const textures = createVolumetricLightmapTextures(device, data, undefined, atlas)
  const view = device.createBuffer({
    label: 'Trillion3D volumetric lightmap view',
    size: VOLUMETRIC_LIGHTMAP_VIEW_WORDS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const block = new Float32Array(VOLUMETRIC_LIGHTMAP_VIEW_WORDS)
  writeVolumetricLightmapView(block, 0, data, true, atlas)
  device.queue.writeBuffer(view, 0, block)
  const sampler = postSamplers(device).clamped
  const streamer =
    room && streaming
      ? createCellStreamer(device, data, {
          room,
          base,
          textures: textures.textures,
          read: streaming.read,
          report: streaming.report,
        })
      : undefined
  return {
    data,
    /** Loads the cells of the finest bricks within `range` metres of `eye`, lets go of the others. */
    update: (eye: ArrayLike<number>, range: number) => streamer?.update(eye, range),
    /** The bind group entries of the lightmap's bindings from `first`
     *  (eleven of them). */
    entries: (first: number) =>
      volumetricLightmapGroupEntries(first, { buffer: view }, sampler, textures),
    /** Frees the textures and the view block. */
    dispose() {
      streamer?.dispose()
      textures.destroy()
      view.destroy()
    },
  }
}

/** The lightmap on the GPU (`createVolumetricLightmapGpu`). */
export type VolumetricLightmapGpu = ReturnType<typeof createVolumetricLightmapGpu>
