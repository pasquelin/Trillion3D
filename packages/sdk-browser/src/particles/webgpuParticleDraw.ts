import { PARTICLE_BLENDS, type ParticlePool } from '../../../sdk-core/src/fluids/particles.ts';
import { createCheckedShaderModule } from '../gpu/core/shaderModule.ts';
import {
  buildRenderPipeline,
  preparedPipeline,
  preparedPipelines,
} from '../lighting/deferred/fullscreen.ts';
import { DRAW_FLOATS, drawOrder, writeDrawWords } from './drawWords.ts';
import { usedSlots } from './poolStates.ts';
import { displayMaskLayout, type DisplayFilter } from '../webgpu/blend/displayFilter.ts';
import { PARTICLE_DRAW_WGSL, PARTICLE_ROUTED_WGSL } from './particlesWgsl.ts';
import { particleTargets } from './particleTargets.ts';
import { PARTICLE_DRAW_PASS } from '../stage/passLabels.ts';

/** What the draw keeps in a pool's step state: its words, its group and the depth it was made on. */
export type DrawState = {
  state: GPUBuffer;
  draw: GPUBuffer;
  drawn?: GPUBindGroup;
  depth?: GPUTextureView;
};

/** The WebGPU particle draw: one pass over the lit image, one instanced draw per live pool, the
 *  opaque depth read for the soft edge. Its pipelines compile in the background, a pool drawn once
 *  its blend's has arrived; those routed through the display layers are asked by the frame entry
 *  that can route a pool (`askRouted`), the frame held until they land. `fail` hears a pipeline not
 *  made; the step then refuses the pools (`refused`). */
export function createWebgpuParticleDraw(
  device: GPUDevice,
  stateOf: (pool: ParticlePool) => DrawState | undefined,
  fail: (error: unknown) => void,
) {
  const { VERTEX, FRAGMENT } = GPUShaderStage;
  const layout = device.createBindGroupLayout({
    label: PARTICLE_DRAW_PASS,
    entries: [
      { binding: 0, visibility: VERTEX | FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: FRAGMENT, texture: { sampleType: 'depth' } },
    ],
  });
  const pipelines: Partial<Record<ParticlePool['blend'], GPURenderPipeline>> = {};
  let failed = false,
    routedProgram: { module: GPUShaderModule; layout: GPUPipelineLayout } | undefined;
  /** The routed pipeline of each blend, its module and layout made by the first one asked. */
  const routed = preparedPipelines((blend: ParticlePool['blend']) => {
    routedProgram ??= {
      module: device.createShaderModule({ code: PARTICLE_ROUTED_WGSL }),
      layout: device.createPipelineLayout({
        bindGroupLayouts: [layout, displayMaskLayout(device)],
      }),
    };
    const { module } = routedProgram;
    return preparedPipeline(device, {
      label: `${PARTICLE_DRAW_PASS} ${blend} routed`,
      layout: routedProgram.layout,
      vertex: { module, entryPoint: 'vs' },
      fragment: {
        module,
        entryPoint: 'fsRouted',
        constants: { DISPLAY_ROUTE: 1 },
        targets: particleTargets(blend, true),
      },
    });
  });
  createCheckedShaderModule(device, PARTICLE_DRAW_WGSL, 'PARTICLE_DRAW')
    .then((module) => {
      const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
      return Promise.all(
        PARTICLE_BLENDS.map(async (blend) => {
          pipelines[blend] = await buildRenderPipeline(device, {
            label: `${PARTICLE_DRAW_PASS} ${blend}`,
            layout: pipelineLayout,
            vertex: { module, entryPoint: 'vs' },
            fragment: { module, entryPoint: 'fs', targets: particleTargets(blend) },
          });
        }),
      );
    })
    .catch((error) => ((failed = true), fail(error)));
  const words = new Float32Array(DRAW_FLOATS),
    order: ParticlePool[] = [];
  /** The pool's group, made again only when the depth target changed. */
  const groupOf = (kept: DrawState, depth: GPUTextureView) => {
    if (kept.depth !== depth) {
      const buffers = [kept.draw, kept.state].map((buffer) => ({ buffer }));
      const entries = [...buffers, depth].map((resource, binding) => ({ binding, resource }));
      kept.drawn = device.createBindGroup({ label: PARTICLE_DRAW_PASS, layout, entries });
      kept.depth = depth;
    }
    return kept.drawn!;
  };
  return {
    /** Draws `pools` over the `width × height` the image draws in `target` (`renderScale.ts`), their coverage in `reactive`'s green (`asIsShare.ts`),
     *  in `encoder`, seen through `viewProj` from `eye`, softened by `depth`, routed through `filter` where its mask is set, shown through `tone` (exposure,
     *  curve) or raw when `unlit`; returns the draws encoded, none without a live particle. */
    draw(
      pools: readonly ParticlePool[],
      encoder: GPUCommandEncoder,
      target: GPUTextureView,
      reactive: GPUTextureView,
      depth: GPUTextureView,
      [width, height]: readonly number[],
      viewProj: ArrayLike<number>,
      eye: ArrayLike<number>,
      filter?: DisplayFilter,
      tone?: ArrayLike<number>,
      unlit = false,
    ) {
      if (failed) return 0;
      let pass: GPURenderPassEncoder | undefined,
        draws = 0;
      for (const pool of drawOrder(pools, eye, order)) {
        const pipeline = filter ? routed.of(pool.blend).get() : pipelines[pool.blend],
          kept = stateOf(pool);
        if (!pipeline || !kept) continue;
        writeDrawWords(words, pool, viewProj, eye);
        words[41] = tone?.[3] ?? 1;
        words[42] = tone?.[4] ?? 0;
        words[43] = unlit ? 1 : 0;
        words[44] = width;
        words[45] = height;
        device.queue.writeBuffer(kept.draw, 0, words);
        pass ??= encoder.beginRenderPass({
          label: PARTICLE_DRAW_PASS,
          colorAttachments: [
            { view: target, loadOp: 'load', storeOp: 'store' },
            ...(filter ? filter.attachments() : []),
            { view: reactive, loadOp: 'load', storeOp: 'store' },
          ],
        });
        pass.setViewport(0, 0, width, height, 0, 1);
        if (filter) pass.setBindGroup(1, filter.maskGroup);
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, groupOf(kept, depth));
        pass.draw(6, usedSlots(pool));
        draws++;
      }
      pass?.end();
      return draws;
    },
    refused: () => failed,
    /** Asks the routed pipelines off the frame: the frame entry's, before an image routes a pool
     *  through the display layers. */
    askRouted() {
      for (const blend of PARTICLE_BLENDS) routed.of(blend).ask();
    },
  };
}
