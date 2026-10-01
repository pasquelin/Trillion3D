import { core } from '../../impostor/borrowed.ts';
import { cardPassWgsl, CARD_VIEW_FLOATS } from './cardWgsl.ts';
import { CARD_FLOATS } from '../../impostor/cards.ts';
import { createImpostorFeed } from './feed.ts';
import type { TextureLevelReader } from '../../texture/levelReader.ts';

/** The pass label the GPU timings and the tests name the card surfaces by. */
export const IMPOSTOR_PASS = 'Trillion3D impostor cards';

/**
 * The card pipelines (#1335) and what they bind: the image's group (view uniform, card records)
 * and the layout of a mesh's atlas group, which the feed fills (`feed.ts`). The visibility stage
 * (`visPipeline`) writes identifier 0, the depth and the pyramid's level 0, with the clusters'
 * targets and depth (`visTargets`, `VIS_DEPTH`); the surface stage (`pipeline`) writes the four opaque surfaces
 * where its depth is the one the visibility stage kept, writing no depth.
 */
export function createImpostorPass(
  device: GPUDevice,
  reader: TextureLevelReader,
  feedOptions: Parameters<typeof createImpostorFeed>[3],
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
  const module = device.createShaderModule({ label: IMPOSTOR_PASS, code: cardPassWgsl() });
  const layout = device.createPipelineLayout({ bindGroupLayouts: [imageLayout, atlasLayout] });
  const make = (
    label: string,
    entryPoint: string,
    targets: GPUColorTargetState[],
    depthStencil: GPUDepthStencilState,
  ) =>
    device.createRenderPipeline({
      label,
      layout,
      vertex: { module, entryPoint: 'card_vs' },
      fragment: { module, entryPoint, targets },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil,
    });
  const pipeline = make(
    IMPOSTOR_PASS,
    'card_fs',
    core.SURFACE_FORMATS.map((format) => ({ format })),
    { format: 'depth32float', depthCompare: core.DEPTH_COMPARE_OR_EQUAL, depthWriteEnabled: false },
  );
  const visPipelines: Partial<Record<'hiz' | 'ids', GPURenderPipeline>> = {};
  const viewBuffer = device.createBuffer({
    label: 'Trillion3D impostor view',
    size: CARD_VIEW_FLOATS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  let cardBuffer: GPUBuffer | undefined, imageGroup: GPUBindGroup | undefined;
  return {
    pipeline,
    /** The visibility stage's pipeline, with the pyramid's level 0 when `hiz`, made once asked. */
    visPipeline(hiz: boolean) {
      return (visPipelines[hiz ? 'hiz' : 'ids'] ??= make(
        `${IMPOSTOR_PASS} visibility`,
        hiz ? 'card_vis_hiz_fs' : 'card_vis_fs',
        core.visTargets(hiz),
        core.VIS_DEPTH,
      ));
    },
    feed: createImpostorFeed(device, atlasLayout, reader, feedOptions),
    viewBuffer,
    /** The image's group over a card buffer of at least `cards` records (`grownCapacity`). */
    imageGroup(cards: number) {
      const bytes = Math.max(1, cards) * CARD_FLOATS * 4;
      if (!cardBuffer || cardBuffer.size < bytes) {
        const size = core.grownCapacity(cardBuffer?.size ?? 0, bytes);
        cardBuffer?.destroy();
        cardBuffer = device.createBuffer({
          label: 'Trillion3D impostor cards',
          size,
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
