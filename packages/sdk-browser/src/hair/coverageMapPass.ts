import { DEPTH_COMPARE_OR_EQUAL } from '../camera/depthConvention.ts'
import { DEPTH_FORMAT } from '../scene/targetFormats.ts'
import { preparedPipeline } from '../lighting/deferred/fullscreen.ts'
import { autoKernel } from '../gpu/core/computeStages.ts'
import { oncePerDevice } from '../gpu/core/oncePerDevice.ts'
import { HAIR_STRANDS_PASS_PREFIX } from '../diagnostic/stage/passLabels.ts'
import { hairCoverageLutBuffer } from './coverageLut.ts'
import { HAIR_COVERAGE_COUNT_WGSL, HAIR_COVERAGE_MAP_WGSL } from './coverageMapWgsl.ts'
import { boundGroups, type DrawnInstance } from './ribbonBinds.ts'
import { SEGMENT_VERTICES } from './transmittanceWgsl.ts'
import { HAIR_TILE_SIZE } from './visibilityMath.ts'

const countModule = oncePerDevice((device) =>
  device.createShaderModule({ code: HAIR_COVERAGE_COUNT_WGSL }),
)
const countPipeline = oncePerDevice((device) => {
  const module = countModule(device)
  return preparedPipeline(device, {
    label: `${HAIR_STRANDS_PASS_PREFIX}coverage count`,
    layout: 'auto',
    vertex: { module, entryPoint: 'hairTransmittanceVs' },
    fragment: { module, entryPoint: 'hairCoverageCount', targets: [] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    // The fragments behind the opaque depth are dropped by the depth unit and by the shader: a fragment that writes a buffer is not dropped before it runs.
    depthStencil: {
      format: DEPTH_FORMAT,
      depthWriteEnabled: false,
      depthCompare: DEPTH_COMPARE_OR_EQUAL,
    },
  })
})
const mapKernel = autoKernel(
  `${HAIR_STRANDS_PASS_PREFIX}coverage mapping`,
  HAIR_COVERAGE_MAP_WGSL,
  'hairCoverageMap',
)

/** The pipelines of the coverage mapping: the count of the strands of a pixel and the map of the count to the transmittance; none while one compiles. */
export function coverageMapPipelines(device: GPUDevice) {
  const count = countPipeline(device).get()
  const map = mapKernel(device).get()
  return count && map ? { count, map } : undefined
}

/** The bind groups of the mapping, kept while the resources they name stay. */
export function coverageMapBinds() {
  return {
    frame: boundGroups<GPUBuffer, GPUTextureView, GPUBuffer>(
      1,
      (device, pipeline, view, depth, counts) =>
        device.createBindGroup({
          layout: pipeline.getBindGroupLayout(1),
          entries: [
            { binding: 0, resource: { buffer: view } },
            { binding: 1, resource: depth },
            { binding: 3, resource: { buffer: counts } },
          ],
        }),
    ),
    map: boundGroups<GPUBuffer, GPUBuffer, GPUTextureView, GPUBuffer>(
      1,
      (device, pipeline, image, counts, transmittance, table) =>
        device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: image } },
            { binding: 1, resource: { buffer: counts } },
            { binding: 2, resource: { buffer: table } },
            { binding: 3, resource: transmittance },
          ],
        }),
    ),
  }
}

/** What the mapping reads of the image: the view and image blocks, the opaque depth, the transmittance it writes. */
interface CoverageMapFrame {
  readonly viewBuffer: GPUBuffer
  readonly depthView: GPUTextureView
  readonly image: GPUBuffer
  readonly transmittance: GPUTextureView
  readonly size: readonly [number, number]
  /** The pixels the strands cover, and the tiles that hold them: `[x0, y0, x1, y1]`. */
  readonly rect: readonly [number, number, number, number]
  readonly tiles: readonly [number, number, number, number]
}

/**
 * Replaces the transmittance of the view by the one the count of the strands gives (`hairVisibilityCoverageMapping`), after the product of the
 * ribbons wrote it: the counts cleared over the rows of the tiles of the strands, the ribbons of `drawn` counted over the rectangle `frame.rect`
 * in a render pass of their own, then a thread a pixel of the tiles maps the count to the coverage (`HAIR_COVERAGE_MAP_WGSL`).
 */
export function encodeCoverageMapping(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  pipelines: NonNullable<ReturnType<typeof coverageMapPipelines>>,
  binds: ReturnType<typeof coverageMapBinds>,
  counts: GPUBuffer,
  frame: CoverageMapFrame,
  drawn: readonly DrawnInstance[],
) {
  const { size, rect, tiles } = frame
  const y0 = tiles[1] * HAIR_TILE_SIZE,
    y1 = Math.min(size[1], tiles[3] * HAIR_TILE_SIZE)
  encoder.clearBuffer(counts, y0 * size[0] * 8, (y1 - y0) * size[0] * 8)
  const pass = encoder.beginRenderPass({
    label: `${HAIR_STRANDS_PASS_PREFIX}coverage count`,
    colorAttachments: [],
    depthStencilAttachment: { view: frame.depthView, depthReadOnly: true },
  })
  pass.setViewport(0, 0, size[0], size[1], 0, 1)
  pass.setScissorRect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1])
  pass.setPipeline(pipelines.count)
  pass.setBindGroup(
    1,
    binds.frame(device, pipelines.count, frame.viewBuffer, frame.depthView, counts),
  )
  for (const instance of drawn) {
    pass.setBindGroup(0, instance.group(pipelines.count))
    pass.draw(instance.pointCount * SEGMENT_VERTICES)
  }
  pass.end()
  const map = encoder.beginComputePass({ label: `${HAIR_STRANDS_PASS_PREFIX}coverage mapping` })
  map.setPipeline(pipelines.map)
  map.setBindGroup(
    0,
    binds.map(
      device,
      pipelines.map,
      frame.image,
      counts,
      frame.transmittance,
      hairCoverageLutBuffer(device),
    ),
  )
  map.dispatchWorkgroups(tiles[2] - tiles[0], tiles[3] - tiles[1])
  map.end()
}
