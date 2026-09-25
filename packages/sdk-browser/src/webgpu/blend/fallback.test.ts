import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { surfaceOf } from '../../page/surface.ts';
import { BLEND_EQUATIONS, hostBlending } from '../../scene/materialBlending.ts';
import { createWebgpuPagesPipelines } from '../pages/prepare/pipelines.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { drawFallbackBlendPass, writeFallbackBlendUniforms } from './fallback.ts';
import { createWebgpuBlendState } from './state.ts';
import type { Blending } from '../../../../sdk-core/src/world/constants/index.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

/** The pipelines the fallback pass sets, one per item it draws, read as the blend of their target. */
function drawn(blendings: (number | undefined)[]) {
  installGpuGlobals();
  const device = {
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createShaderModule: () => ({}),
    createRenderPipeline: (descriptor: GPURenderPipelineDescriptor) => descriptor,
    createBindGroup: () => ({}),
  } as unknown as GPUDevice;
  const { pipelineBlend } = createWebgpuPagesPipelines(device, 256);
  const set: GPUBlendState[] = [];
  const pass = {
    setViewport() {},
    setBindGroup() {},
    setPipeline: (pipeline: GPURenderPipelineDescriptor) => {
      const target = [...pipeline.fragment!.targets][0]!;
      set.push(target.blend!);
    },
    draw() {},
    end() {},
  };
  const blendState = createWebgpuBlendState();
  blendState.visibleBlend = blendings.map((blending) => {
    const surface = G.basicSurface();
    Object.assign(surface, { blending });
    return { surface: surfaceOf(surface), count: 3, position: {} as GPUBuffer };
  }) as unknown as typeof blendState.visibleBlend;
  const rt = {
    vis: {},
    gpu: {
      pipelineBlend,
      colorView: {},
      depthView: {},
      targetSize: [8, 8],
      bindGroupLayout: {},
      uniformBuffer: {},
      cache: { buffer: {} },
    },
    run: { gpuDrawCalls: 0, blendDrawCalls: 0, blendUnpagedTriangles: 0, blendPagedTriangles: 0 },
    blendState,
  } as unknown as WebgpuPagesRuntime;
  const encoder = { beginRenderPass: () => pass } as unknown as GPUCommandEncoder;
  drawFallbackBlendPass(rt, device, encoder, 0);
  return set;
}

test('the fallback pass draws each item with the equation of its own blending mode', () => {
  const modes: Blending[] = ['additive', 'normal', 'normal', 'multiply', 'subtractive'];
  const set = drawn(modes.map(hostBlending));
  // The pipeline is set when the mode changes, never twice in a row for the same one.
  assert.deepEqual(
    set,
    ['additive', 'normal', 'multiply', 'subtractive'].map(
      (mode) => BLEND_EQUATIONS[mode as Blending],
    ),
  );
});

test('the fallback pass refuses by name a blending no path draws', () => {
  assert.throws(() => drawn([99]), /declares a blending no path draws/);
});

// #348: the transparent fallback reads float positions and no direction, so it cannot widen a
// line quad (`lineClip`): it refuses a line surface by name instead of dropping it.
function writeLines(lineWidth: number) {
  const written: number[] = [];
  const rt = {
    run: { diagnostic: 'beauty' },
    blendState: {
      visibleBlend: [
        {
          surface: surfaceOf(G.basicSurface({ transparent: true, opacity: 0.5, lineWidth })),
          matrix: new G.Matrix4(),
          rgba: [1, 1, 1, 0.5],
          count: 6,
          flags: 0,
        },
      ],
    },
    gpu: { uniformPacked: new Float32Array(64).fill(7), uniformBuffer: {} },
  } as unknown as WebgpuPagesRuntime;
  const device = {
    queue: { writeBuffer: () => written.push(1) },
  } as unknown as GPUDevice;
  writeFallbackBlendUniforms(rt, device, 0);
  return { written, packed: rt.gpu.uniformPacked };
}

test('the transparent fallback refuses a line surface by name', () => {
  assert.throws(() => writeLines(2), /FALLBACK_TRANSPARENT_LINES_UNSUPPORTED/);
});

test('the transparent fallback draws a triangle surface with no line width', () => {
  const { written, packed } = writeLines(0);
  assert.equal(written.length, 1);
  assert.equal(packed[40], 0);
});
