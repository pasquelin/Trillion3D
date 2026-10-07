import { encoder } from './planFrames.fixture.ts'
import type { VsmRenderScene } from './renderPass.ts'
import { emptyRowSpheres } from './rowPageBound.fixture.ts'

/** What a raster pass of `rowCount` rows under one sun is encoded with, on a recording device: the
 *  recording encoder, the scene on one tiny buffer, and the sun. */
export function recordingRaster(device: GPUDevice, rowCount: number) {
  const buffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE })
  const scene: VsmRenderScene = {
    rowCount,
    ...{ pageTable: buffer, spheres: buffer, mobility: buffer, rowLods: buffer },
    pageLayout: {} as GPUBindGroupLayout,
    pageGroup: {} as GPUBindGroup,
    rowSpheres: emptyRowSpheres(),
    camera: {
      ...{ eye: [0, 0, 0], view: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
      ...{ focalPixels: 100, near: 0.1, perspective: true, threshold: 1 },
    },
  }
  const lights = [{ kind: 'directional' as const, firstId: 0, count: 1, shouldRender: true }]
  return { encoder, scene, lights }
}
