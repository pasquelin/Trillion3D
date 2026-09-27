// The blending modes a scene declares are compiled off the frame, at prepare, on both transparent
// paths: the first draw in such a mode finds its pipeline and compiles nothing. What is compiled is
// what the draw would have compiled itself, descriptor for descriptor: the image cannot change.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { surfaceOf } from '../../page/surface.ts';
import { BLEND_MODES, hostBlending } from '../../scene/materialBlending.ts';
import { createWebgpuPagesPipelines } from '../pages/prepare/pipelines.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { declaredBlendModes, pipelinesByMode } from './stagePipelines.ts';
import type { BlendGpuItem } from './state.ts';

/** Blend items as prepare leaves them, one per host blending constant. */
function items(blendings: (number | undefined)[], transmissive: boolean[] = []) {
  return blendings.map((blending, index) => {
    const surface = G.basicSurface();
    Object.assign(surface, { blending });
    return { surface: surfaceOf(surface), transmissive: !!transmissive[index] };
  }) as unknown as BlendGpuItem[];
}

test('the declared modes are normal, then every mode a non-transmissive item names, in rank', () => {
  assert.deepEqual(declaredBlendModes([]), ['normal']);
  const all = items([...BLEND_MODES].reverse().map(hostBlending));
  assert.deepEqual(declaredBlendModes(all), BLEND_MODES);
  const glass = items([hostBlending('additive'), hostBlending('multiply')], [true, false]);
  assert.deepEqual(declaredBlendModes(glass), ['normal', 'multiply'], 'transmission blends normal');
});

test('a precompiled mode is drawn without a compile; a mode a draw compiled first is kept', async () => {
  const built: string[] = [];
  const set = pipelinesByMode(
    (mode) => (built.push(`now:${mode}`), { mode, now: true }),
    async (mode) => (built.push(`async:${mode}`), { mode, now: false }),
  );
  const drawn = set.at('multiply');
  await set.precompile(['normal', 'additive', 'multiply']);
  assert.deepEqual(built, ['now:multiply', 'async:normal', 'async:additive']);
  assert.equal(set.at('multiply'), drawn, 'the pipeline a draw already bound is not replaced');
  assert.equal(set.at('additive').now, false);
  assert.equal(set.at('normal').now, false);
  assert.equal(built.length, 3, 'no draw compiles a precompiled mode');
  await set.precompile(['additive']);
  assert.equal(built.length, 3, 'a compiled mode is never compiled again');
});

test('the fallback pass precompiles, off the frame, the very pipeline a draw would compile', async () => {
  const lazy = fakeDevice(),
    eager = fakeDevice();
  const drawnLazily = createWebgpuPagesPipelines(lazy.device, 256).pipelineBlend;
  const precompiled = createWebgpuPagesPipelines(eager.device, 256).pipelineBlend;
  const modes = declaredBlendModes(items(BLEND_MODES.map(hostBlending)));
  await precompiled.precompile(modes);
  const compiledAtPrepare = eager.renderPipelines.length;
  // The fake's pipeline is its descriptor; each device builds its own module, so the descriptors
  // are compared as data.
  for (const mode of modes)
    assert.equal(JSON.stringify(precompiled.at(mode)), JSON.stringify(drawnLazily.at(mode)), mode);
  assert.equal(eager.renderPipelines.length, compiledAtPrepare, 'no draw compiled a pipeline');
});
