import type { SceneProxy, BounceCascades } from '../../../sdk-core/src/index.ts';
import { constructGpuResources } from '../gpu/core/errorScope.ts';
import { createGpuBounceProxy } from './proxy.ts';
import { createBounceUniform } from './uniform.ts';
import { BOUNCE_ATLAS_FORMAT } from './atlas.ts';

/** Initial probe storage is atomic even when admission refuses the last resource. The probes and
 *  their snapshot are atlases of `extent` (`probeAtlasExtent`): the update writes the one, reads
 *  the other, which then takes the texels written (`BOUNCE_SNAPSHOT_SHADER`); a level is cleared
 *  in both by one render pass on its layer, so the two stay equal between updates. */
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
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const snapshot = device.createTexture({
      label: 'Trillion3D bounce probes snapshot v3',
      size: extent,
      format: BOUNCE_ATLAS_FORMAT,
      usage:
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    /** One view per level of `atlas`, which a clear renders to. */
    const layers = (atlas: GPUTexture) =>
      Array.from({ length: extent[2] }, (_, level) =>
        atlas.createView({ dimension: '2d', baseArrayLayer: level, arrayLayerCount: 1 }),
      );
    const views = {
      probes: probes.createView({ dimension: '2d-array' }),
      snapshot: snapshot.createView({ dimension: '2d-array' }),
      levels: layers(probes),
      snapshotLevels: layers(snapshot),
    };
    /** A level's clear: one render pass on its layer in both atlases; the descriptor is made
     *  once, its two views set to the level cleared. */
    const attachments: GPURenderPassColorAttachment[] = [0, 1].map(() => ({
      view: views.levels[0],
      loadOp: 'clear',
      storeOp: 'store',
    }));
    const clear: GPURenderPassDescriptor = {
      label: 'Trillion3D bounce probe level clear',
      colorAttachments: attachments,
    };
    /** Zeroes the levels whose bit `levels` sets, in both atlases. */
    const clearLevels = (encoder: GPUCommandEncoder, levels: number) => {
      for (let level = 0; levels && level < views.levels.length; level++) {
        if (!(levels & (1 << level))) continue;
        attachments[0].view = views.levels[level];
        attachments[1].view = views.snapshotLevels[level];
        encoder.beginRenderPass(clear).end();
      }
    };
    return { resident, uniform, queue, probes, snapshot, views, clearLevels };
  });
}
