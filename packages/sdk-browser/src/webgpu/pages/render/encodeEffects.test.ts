// The effect chain on the WebGPU path (#349): a held frame redisplays the image the chain drew and
// does no work of its own; a change of the chain breaks the hold; a diagnostic view and a capture
// show the engine's image without it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EffectChain } from '../../../../../sdk-core/src/world/effect/chain.ts';
import { effect } from '../../../../../sdk-core/src/world/effect/index.ts';
import { holdWebgpuFrame, keepWebgpuFrame } from '../../frame/hold.ts';
import { settledRt } from '../../frame/hold.fixture.ts';
import { effectsUnsettled, encodeEffects } from './encodeEffects.ts';
import { fakeDevice } from '../../../../../../tests/kit/gpu/fakeDevice.ts';
import type { AccumulatedImage } from '../../../lighting/deferred/program.ts';

const input = { color: {}, share: {} } as AccumulatedImage;
/** Counts the passes the chain begins. */
let begun = 0;
const encoder = {
  beginRenderPass: () => (begun++, { setPipeline() {}, setBindGroup() {}, draw() {}, end() {} }),
} as unknown as GPUCommandEncoder;

/** A settled runtime drawing `chain`, in the beauty view, with no pass drawn yet. */
function drawing(chain: EffectChain) {
  const rt = settledRt();
  rt.context.effects = chain;
  Object.assign(rt.run, { diagnostic: 'beauty' });
  Object.assign(rt.gpu, { targetSize: [8, 4] });
  return rt;
}

/** Two identical complete frames, each encoding the chain: what arms the hold. */
function drawTwice(rt: ReturnType<typeof drawing>, device: GPUDevice) {
  for (let i = 0; i < 2; i++) {
    rt.run.gpuDrawCalls = 2; // what a frame counts from, before its passes
    encodeEffects(rt, device, encoder, input);
    rt.run.frame++;
    keepWebgpuFrame(rt);
  }
}

test('a held frame with a chain does no work; a change of the chain draws it again', async () => {
  const { device } = fakeDevice();
  const chain = new EffectChain(),
    bloom = effect.bloom();
  const rt = drawing(chain);
  chain.add(bloom);
  encodeEffects(rt, device, encoder, input);
  while (rt.gpu.effects!.loading) await new Promise((resolve) => setImmediate(resolve));
  drawTwice(rt, device);
  const composed = encodeEffects(rt, device, encoder, input);
  assert.notEqual(composed?.color, input.color, "composition reads the chain's output");
  assert.equal(composed?.share, input.share, 'with the as-is share of the image it read');
  const lit = {} as GPUTextureView;
  rt.gpu.hdrView = lit;
  const still = encodeEffects(rt, device, encoder, undefined);
  assert.ok(still?.color && still.color !== lit && still.share === undefined, 'a still image too');
  drawTwice(rt, device);
  const drawn = begun;
  assert.ok(drawn > 0, 'the full frames drew the bloom');
  assert.equal(holdWebgpuFrame(rt, device), true, 'still: the image the chain drew is redisplayed');
  assert.equal(holdWebgpuFrame(rt, device), true);
  assert.equal(begun, drawn, 'held frames draw no pass of the chain');
  bloom.intensity = 0.3;
  assert.equal(holdWebgpuFrame(rt, device), false, 'a setting changed: the image is out of date');
  assert.equal(rt.run.frameHeld, false);
});

test('compiling programs keep the frame from being held', () => {
  const { device } = fakeDevice();
  const chain = new EffectChain().add(effect.bloom());
  const rt = drawing(chain);
  drawTwice(rt, device);
  assert.equal(rt.gpu.effects!.loading, true);
  assert.equal(holdWebgpuFrame(rt, device), false, 'the image lacks the chain it will have');
});

test('a diagnostic view, a capture and an empty chain make nothing and hand the input on', () => {
  const { device, textures } = fakeDevice();
  const chain = new EffectChain();
  const rt = drawing(chain);
  assert.equal(encodeEffects(rt, device, encoder, input), input);
  assert.equal(rt.gpu.effects, undefined, 'an empty chain has no targets and no programs');
  chain.add(effect.bloom());
  Object.assign(rt.run, { diagnostic: 'normals' });
  assert.equal(encodeEffects(rt, device, encoder, input), input);
  assert.equal(rt.gpu.effectsRevision, chain.revision, 'a diagnostic view shows no chain to miss');
  Object.assign(rt.run, { diagnostic: 'beauty' });
  rt.capture.capturing = true;
  assert.equal(encodeEffects(rt, device, encoder, input), input);
  assert.deepEqual([rt.gpu.effects, textures.length], [undefined, 0]);
  // The main view a capture restores is drawn without the chain: the next image draws it again.
  assert.equal(rt.gpu.effectsRevision, -1);
  rt.capture.capturing = false;
  assert.equal(effectsUnsettled(rt), true, 'no hold on that image');
});
