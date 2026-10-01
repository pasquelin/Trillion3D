import { SURFACE_FORMATS } from '../../scene/surfaceBuffer.ts';
import { DEPTH_COMPARE } from '../../camera/depthConvention.ts';
import { CARD_FLOATS, CARD_PASS_WGSL, CARD_VIEW_FLOATS } from './cardWgsl.ts';
import { createImpostorFeed } from './feed.ts';
import type { TextureLevelReader } from '../../texture/levelReader.ts';

/** The pass label the GPU timings and the tests name the card draw by. */
export const IMPOSTOR_PASS = 'Trillion3D impostor cards';

/**
 * The card pipeline (#1335) and what it binds: the image's group (view uniform, card records) and
 * the layout of a mesh's atlas group, which the feed fills (`feed.ts`). It writes the four opaque
 * surfaces and the scene depth, testing it as every opaque raster does (`DEPTH_COMPARE`).
 */
export function createImpostorPass(
  device: GPUDevice,
  reader: TextureLevelReader,
  landed: () => void,
) {
  const FRAGMENT = GPUShaderStage.FRAGMENT,
    VERTEX = GPUShaderStage.VERTEX;
  const imageLayout = device.createBindGroupLayout({
    label: 'Trillion3D impostor image',
    entries: [
      { binding: 0, visibility: VERTEX | FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: VERTEX | FRAGMENT, buffer: { type: 'read-only-storage' } },
    ],
  });
  const atlasLayout = device.createBindGroupLayout({
    label: 'Trillion3D impostor atlas',
    entries: [
      ...[0, 1, 2].map((binding) => ({
        binding,
        visibility: FRAGMENT,
        texture: { sampleType: 'float' as const },
      })),
      { binding: 3, visibility: FRAGMENT, sampler: { type: 'filtering' as const } },
    ],
  });
  const module = device.createShaderModule({ label: IMPOSTOR_PASS, code: CARD_PASS_WGSL });
  const pipeline = device.createRenderPipeline({
    label: IMPOSTOR_PASS,
    layout: device.createPipelineLayout({ bindGroupLayouts: [imageLayout, atlasLayout] }),
    vertex: { module, entryPoint: 'card_vs' },
    fragment: {
      module,
      entryPoint: 'card_fs',
      targets: SURFACE_FORMATS.map((format) => ({ format })),
    },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: 'depth32float', depthCompare: DEPTH_COMPARE, depthWriteEnabled: true },
  });
  const viewBuffer = device.createBuffer({
    label: 'Trillion3D impostor view',
    size: CARD_VIEW_FLOATS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  let cardBuffer: GPUBuffer | undefined, imageGroup: GPUBindGroup | undefined;
  return {
    pipeline,
    feed: createImpostorFeed(device, atlasLayout, reader, landed),
    viewBuffer,
    /** The image's group over a card buffer of at least `cards` records, grown by doubling. */
    imageGroup(cards: number) {
      const bytes = Math.max(1, cards) * CARD_FLOATS * 4;
      if (!cardBuffer || cardBuffer.size < bytes) {
        cardBuffer?.destroy();
        cardBuffer = device.createBuffer({
          label: 'Trillion3D impostor cards',
          size: Math.max(bytes, (cardBuffer?.size ?? 0) * 2),
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        imageGroup = device.createBindGroup({
          label: 'Trillion3D impostor image',
          layout: imageLayout,
          entries: [
            { binding: 0, resource: { buffer: viewBuffer } },
            { binding: 1, resource: { buffer: cardBuffer } },
          ],
        });
      }
      return { group: imageGroup!, buffer: cardBuffer };
    },
    dispose() {
      this.feed.dispose();
      viewBuffer.destroy();
      cardBuffer?.destroy();
    },
  };
}

export type ImpostorPass = ReturnType<typeof createImpostorPass>;
