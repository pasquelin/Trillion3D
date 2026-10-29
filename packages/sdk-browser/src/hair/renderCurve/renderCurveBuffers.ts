import { clampLowWins } from '../../../../math/src/scalar/reals.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { RENDER_CURVE_COUNTER_WORDS } from './paramsWgsl.ts'
import { renderCurveHzbWords } from './hzbWgsl.ts'
import {
  RENDER_CURVE_BINNER_LAYERS,
  RENDER_CURVE_CLUSTERS_PER_INSTANCE,
  RENDER_CURVE_ENTRY_WORDS,
  RENDER_CURVE_SEGMENT_BYTES,
  type RenderCurveCommon,
} from './renderCurveMath.ts'

/** The visible clusters an image may name: a share of the instances', held to what a storage binding of `capBytes` holds. */
export const renderCurveMaxVisibleClusters = (instanceCount: number, capBytes: number) =>
  clampLowWins(RENDER_CURVE_CLUSTERS_PER_INSTANCE * instanceCount, 1, Math.floor(capBytes / 8))

/** What decides the buffers' sizes: they are made again when it changes. */
export const renderCurveBuffersKey = (
  common: RenderCurveCommon,
  instanceCount: number,
  maxVisible: number,
) =>
  [
    common.resolution.join('x'),
    common.numBinners,
    common.maxTileAllocCount,
    common.maxSegmentDataCount,
    instanceCount,
    maxVisible,
  ].join(' ')

/**
 * THE BUFFERS THE CURVE RASTER'S PASSES FILL, for an image of `common`'s size: the counters, the visible instances and the arguments
 * of the dispatch over them, the visible clusters, the binners' counts per tile and layer, the tile data and the binned segments, the
 * compacted segments, their z bins and the raster work, and the pyramid of the scene's furthest depth. `cleared` are those an image
 * empties before it fills them.
 */
export function createRenderCurveBuffers(
  device: GPUDevice,
  common: RenderCurveCommon,
  instanceCount: number,
  maxVisible: number,
) {
  const make = (label: string, bytes: number, extra = 0) =>
    device.createBuffer({
      label: `hair curve raster ${label}`,
      size: Math.max(16, bytes),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | extra,
    })
  const tiles = common.binTileRes[0] * common.binTileRes[1]
  const buffers = {
    counters: make('counters', RENDER_CURVE_COUNTER_WORDS * 4),
    instanceArgs: make('visible instance arguments', 16, GPUBufferUsage.INDIRECT),
    visibleInstances: make('visible instances', instanceCount * 4),
    visibleClusters: make('visible clusters', maxVisible * 8),
    tileSegments: make('tile counts', tiles * common.numBinners * RENDER_CURVE_BINNER_LAYERS * 4),
    tileData: make('tile data', common.maxTileAllocCount * RENDER_CURVE_ENTRY_WORDS * 4),
    segmentData: make('binned segments', common.maxSegmentDataCount * RENDER_CURVE_SEGMENT_BYTES),
    zBinData: make('z bins', common.maxZBinDataCount * 8),
    zBinSegments: make(
      'compacted segments',
      common.maxZBinSegmentDataCount * RENDER_CURVE_SEGMENT_BYTES,
    ),
    rasterWork: make('raster work', common.maxRasterWorkCount * 8),
    hzb: make(
      'furthest depth',
      renderCurveHzbWords(common.resolution[0], common.resolution[1]) * 4,
    ),
  }
  return {
    ...buffers,
    /** The buffers an image empties before it fills them. */
    cleared: [buffers.counters, buffers.instanceArgs, buffers.tileSegments, buffers.tileData],
    destroy: () =>
      retire(device, {
        destroy: () => Object.values(buffers).forEach((buffer) => buffer.destroy()),
      }),
  }
}

export type RenderCurveBuffers = ReturnType<typeof createRenderCurveBuffers>
