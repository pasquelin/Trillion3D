import type { SceneProxy, BounceCascades } from '../../../sdk-core/src/index.ts';
import { constructGpuResources } from '../gpu/core/errorScope.ts';
import { createGpuBounceProxy } from './proxy.ts';
import { createBounceUniform } from './uniform.ts';
import { BOUNCE_ATLAS_FORMAT } from './atlas.ts';

/** Initial probe storage is atomic even when admission refuses the last resource. The probes and
 *  their snapshot are atlases of `extent` (`probeAtlasExtent`): the pass writes the one, reads the
 *  other, and a level is cleared by a render pass on its layer. */
export function createProbeStorage(
  device: GPUDevice,
  proxy: SceneProxy,
  cascades: BounceCascades,
  queueBytes: number,
  extent: [number, number, number],
) {
  return constructGpuResources(device, () => {
    const resident = createGpuBounceProxy(device, proxy);
    const uniform = createBounceUniform(device, cascades);
    const queue = device.createBuffer({
      label: 'Trillion3D bounce probe queue v1',
      size: queueBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const probes = device.createTexture({
      label: 'Trillion3D bounce probes v3',
      size: extent,
      format: BOUNCE_ATLAS_FORMAT,
      usage:
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const snapshot = device.createTexture({
      label: 'Trillion3D bounce probes snapshot v3',
      size: extent,
      format: BOUNCE_ATLAS_FORMAT,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    const views = {
      probes: probes.createView({ dimension: '2d-array' }),
      snapshot: snapshot.createView({ dimension: '2d-array' }),
      /** One view per level, which a clear renders to. */
      levels: Array.from({ length: extent[2] }, (_, level) =>
        probes.createView({ dimension: '2d', baseArrayLayer: level, arrayLayerCount: 1 }),
      ),
    };
    /** Zeroes the levels whose bit `levels` sets: a render pass clears each one's layer. */
    const clearLevels = (encoder: GPUCommandEncoder, levels: number) => {
      views.levels.forEach((view, level) => {
        if (levels & (1 << level))
          encoder
            .beginRenderPass({
              label: 'Trillion3D bounce probe level clear',
              colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }],
            })
            .end();
      });
    };
    return { resident, uniform, queue, probes, snapshot, views, clearLevels };
  });
}
