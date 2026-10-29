import { STORAGE, UNIFORM } from './voxelGrid/bufferUsage.ts'
import { gridParamsOf } from './voxelGrid/gridParamsOf.ts'
import { VG_GRID_PARAMS_BYTES } from './voxelGrid/gridEvalWgsl.ts'
import { encodeRenderTransmittance } from './voxelGrid/renderTransmittancePass.ts'
import { VG_TRANSMITTANCE_PARAMS_BYTES } from './voxelGrid/renderTransmittanceWgsl.ts'
import type { FrameContext } from './liveShadingContext.ts'
import { bufferOf } from './liveShadingState.ts'
import { writeViewBuffer } from './liveShadingVolume.ts'
import { HV_VIEW_BYTES } from './liveShadingView.ts'

/**
 * The image of the volumes replaced by the transmittance through the voxel grids (`RenderTransmittanceWithVoxelGrid`, `HeterogeneousVolumes.cpp:1145`),
 * found the way `mode` (the debug mode, 1 to 9) names, over the grids the shadows phase built: the image is written in place of the volumes', and
 * composed over the lit image as theirs are.
 */
export function encodeVoxelGridDebug(c: FrameContext, mode: number) {
  const { device, held } = c
  const grids = held.voxelGrids ?? {}
  const parameters = bufferOf(
    held,
    device,
    'grid transmittance parameters',
    VG_TRANSMITTANCE_PARAMS_BYTES,
    UNIFORM,
  )
  const gridUniform = bufferOf(
    held,
    device,
    'grid transmittance grids',
    VG_GRID_PARAMS_BYTES,
    UNIFORM,
  )
  device.queue.writeBuffer(gridUniform, 0, gridParamsOf(grids.ortho, grids.frustum))
  encodeRenderTransmittance({
    device,
    encoder: c.encoder,
    mode: mode - 1,
    parameters,
    grids: gridUniform,
    view: writeViewBuffer(
      c,
      bufferOf(held, device, 'grid transmittance view', HV_VIEW_BYTES, UNIFORM),
      false,
      [0, 0, 0, 0, 0, 0, 0, 0],
    ),
    depth: c.rt.gpu.depthView!,
    image: c.target.images[1 - c.ping].createView(),
    size: c.scaled,
    ortho: grids.ortho,
    frustum: grids.frustum,
    stand: bufferOf(held, device, 'grid stand-in', 16, STORAGE),
    maxTraceDistance: c.settings('heterogeneousVolumesMaxTraceDistance'),
  })
  c.first = false
  c.ping = 1 - c.ping
}
