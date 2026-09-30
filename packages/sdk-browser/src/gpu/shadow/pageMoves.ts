import { SHADOW_PAGE, pageOrigin } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { createCheckedShaderModule } from '../core/shaderModule.ts';
import { buildRenderPipeline } from '../../lighting/deferred/fullscreen.ts';
import { layerViews } from './layers.ts';
import type { ShadowTransmittance } from './transmittance.ts';
import { PAGE_MOVE_SHADER } from './pageWgsl.ts';

/** Words of one move: where the page was — its first texel, its layer, the page's texels a side —,
 *  then where it goes, the target's texels a side last. */
const MOVE_WORDS = 8;

/** The moves of every page `moved` names (`resizeShadowPool`), from a pool of `fromSide` pages a
 *  side to one of `toSide`, at `scale` of the pool's texels — ½ for the transmittance layer —, in
 *  the order of their target pages, so each target layer's moves are one run. */
function shadowPageMoves(moved: Int32Array, fromSide: number, toSide: number, scale = 1) {
  const words: number[] = [],
    page = SHADOW_PAGE * scale;
  for (const [was, now] of moved.entries()) {
    if (now < 0) continue;
    const from = pageOrigin(was, fromSide),
      to = pageOrigin(now, toSide);
    words.push(from.x * scale, from.y * scale, from.layer, page);
    words.push(to.x * scale, to.y * scale, to.layer, toSide * page);
  }
  return Uint32Array.from(words);
}

/**
 * THE PAGES A RESIZED POOL KEEPS, MOVED TO THEIR NEW PLACE. Its pipeline is compiled first, off
 * any frame; `move` then copies each page `moved` names (`resizeShadowPool`) — its depth, and its
 * transmittance and translucent depth when that layer is held — texel for texel from the old pool,
 * `fromSide` pages a side, into the new one, `toSide`, and submits it before any frame reads the
 * new pool. Nothing is drawn again: the page reads as it did.
 */
export async function createShadowPageMover(device: GPUDevice) {
  const module = await createCheckedShaderModule(device, PAGE_MOVE_SHADER, 'PAGE_MOVE');
  const pipeline = await buildRenderPipeline(device, {
    label: 'Trillion3D shadow page move v1',
    layout: 'auto',
    vertex: { module, entryPoint: 'move_vs' },
    fragment: { module, entryPoint: 'move_fs', targets: [] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    // The pool's format, and the translucent depth's: one pipeline moves both.
    depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'always' },
  });
  /** Draws the depth of the pages `moves` names from `source` into `target`, one pass a target
   *  layer. Returns the moves' buffer, to free once submitted; nothing when no page moves (a
   *  storage binding holds at least one move). */
  const moveDepth = (
    encoder: GPUCommandEncoder,
    source: GPUTexture,
    target: GPUTexture,
    moves: Uint32Array<ArrayBuffer>,
  ) => {
    if (!moves.length) return undefined;
    const buffer = device.createBuffer({
      label: 'Trillion3D shadow page moves v1',
      size: moves.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(buffer, 0, moves);
    const group = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer } },
        { binding: 1, resource: source.createView({ dimension: '2d-array' }) },
      ],
    });
    const count = moves.length / MOVE_WORDS,
      layerOf = (move: number) => moves[move * MOVE_WORDS + 6];
    let first = 0;
    for (const [layer, view] of layerViews(target).entries()) {
      let last = first;
      while (last < count && layerOf(last) === layer) last++;
      if (last === first) continue;
      const pass = encoder.beginRenderPass({
        label: 'Trillion3D shadow page move v1',
        colorAttachments: [],
        depthStencilAttachment: { view, depthLoadOp: 'load', depthStoreOp: 'store' },
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.draw(6, last - first, 0, first);
      pass.end();
      first = last;
    }
    return buffer;
  };
  return {
    move(
      moved: Int32Array,
      [fromSide, toSide]: [number, number],
      [from, to]: [GPUTexture, GPUTexture],
      layers?: [ShadowTransmittance, ShadowTransmittance],
    ) {
      const encoder = device.createCommandEncoder({ label: 'Trillion3D shadow pool resize' });
      const buffers = [moveDepth(encoder, from, to, shadowPageMoves(moved, fromSide, toSide))];
      if (layers) {
        const half = shadowPageMoves(moved, fromSide, toSide, 0.5),
          [before, after] = layers;
        buffers.push(moveDepth(encoder, before.nearest, after.nearest, half));
        for (let at = 0; at < half.length; at += MOVE_WORDS)
          encoder.copyTextureToTexture(
            { texture: before.colour, origin: [half[at], half[at + 1], half[at + 2]] },
            { texture: after.colour, origin: [half[at + 4], half[at + 5], half[at + 6]] },
            [half[at + 3], half[at + 3], 1],
          );
      }
      device.queue.submit([encoder.finish()]);
      // A buffer destroyed after its submit outlives the work that reads it.
      for (const buffer of buffers) buffer?.destroy();
    },
  };
}
