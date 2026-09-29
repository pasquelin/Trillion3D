// Defect this test catches (#816): a stage reads a binding its layout does not show it. The
// visibility fragment came to read `uni` (the texture level bias of `atlasLod`) while the layout
// gave the uniform to the vertex stage alone; the device refused the pipeline and no WebGPU scene
// opened. Each entry point's reach is read from the shipped text, its calls followed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuVisibilityShaders } from '../visibility/shaders.ts';
import { createWebgpuShadePipelines } from '../visibility/pipelines.ts';
import { createWebgpuBlendPipelines } from '../blend/pipelines.ts';
import { SHADE_SHADER, VIS_SHADER } from '../../visibility/buffer.ts';
import { BLEND_SHADER } from '../blend/shader.ts';
import { functionsOf } from '../../texture/shaderRule.fixture.ts';
import { VIS_BINDINGS } from './bindLayout.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';

/** A stage's visibility bit; read at the call, once the test globals (`fakeDevice`) are set. */
const stageBit = (stage: 'vertex' | 'fragment' | 'compute') =>
  ({
    vertex: GPUShaderStage.VERTEX,
    fragment: GPUShaderStage.FRAGMENT,
    compute: GPUShaderStage.COMPUTE,
  })[stage];

/** Per entry point of `source`, its stage and the group-0 bindings its code names (a member
 *  access, `x.name`, names none). */
function reachedBindings(source: string) {
  const functions = new Set([...source.matchAll(/\bfn (\w+)\(/g)].map((match) => match[1]));
  const globals = new Map(
    [...source.matchAll(/@group\(0\)\s*@binding\((\d+)\)\s*var(?:<[^>]*>)?\s*(\w+)/g)].map(
      (match) => [match[2], Number(match[1])],
    ),
  );
  return [...source.matchAll(/@(vertex|fragment|compute)\b[^{]*?\bfn (\w+)\(/g)].map((entry) => {
    const reached = new Set([entry[2]]),
      bindings = new Set<number>();
    for (const name of reached)
      for (const word of functionsOf(source, [name]).match(/(?<![.\w])[A-Za-z_]\w*/g) ?? []) {
        if (functions.has(word)) reached.add(word);
        const binding = globals.get(word);
        if (binding !== undefined) bindings.add(binding);
      }
    return { stage: entry[1] as Parameters<typeof stageBit>[0], entry: entry[2], bindings };
  });
}

function assertVisible(source: string, layout: GPUBindGroupLayout, what: string) {
  const { entries } = layout as unknown as { entries: GPUBindGroupLayoutEntry[] };
  const reached = reachedBindings(source);
  assert.ok(reached.length > 0, `${what}: its entry points are found`);
  for (const { stage, entry, bindings } of reached)
    for (const binding of bindings) {
      const at = entries.find((candidate) => candidate.binding === binding);
      assert.ok(at, `${what}: ${entry} reads binding ${binding}, absent from the layout`);
      assert.ok(
        (at.visibility & stageBit(stage)) !== 0,
        `${what}: ${entry} (${stage}) reads binding ${binding}, not visible to its stage`,
      );
    }
}

test('every binding a stage of the visibility, resolve and transparent passes reads is visible to it', async () => {
  const { device } = fakeDevice();
  const { visBindGroupLayout } = await createWebgpuVisibilityShaders(device, 8);
  const { shadeBindGroupLayout } = await createWebgpuShadePipelines(
    device,
    {} as GPUShaderModule,
    [],
  );
  const { blendBindGroupLayout } = await createWebgpuBlendPipelines(device, []);
  assertVisible(VIS_SHADER, visBindGroupLayout, 'visibility');
  assertVisible(SHADE_SHADER, shadeBindGroupLayout, 'resolve');
  assertVisible(BLEND_SHADER, blendBindGroupLayout, 'transparents');
  // The visibility fragment picks its cutout's level with the frame's texture bias.
  const fragment = reachedBindings(VIS_SHADER).find(({ entry }) => entry === 'vis_fs');
  assert.ok(fragment?.bindings.has(VIS_BINDINGS.uniform), 'vis_fs reads the uniform');
});
