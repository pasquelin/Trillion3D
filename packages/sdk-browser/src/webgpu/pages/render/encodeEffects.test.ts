// The effect chain on the WebGPU path (#349): a held frame redisplays the image the chain drew and
// does no work of its own; a change of the chain breaks the hold; a diagnostic view and a capture
// show the engine's image without it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EffectChain } from '../../../../../sdk-core/src/world/effect/chain.ts';
import { effect } from '../../../../../sdk-core/src/world/effect/index.ts';
import { holdWebgpuFrame, keepWebgpuFrame, unsettledMask } from '../../frame/hold.ts';
import { settledRt } from '../../frame/hold.fixture.ts';
import { encodeEffects } from './encodeEffects.ts';
import { pendingWebgpuFrame } from '../../frame/interactiveFrame.ts';
import { WEBGPU_KINDS } from '../../../effects/webgpuEffects.ts';
import { createExplorerFrameScheduler } from '../../../world/render/frameScheduler.ts';
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
  assert.equal(unsettledMask(rt), 0, 'the chain runs after the resolve: accumulation stays still');
});

test('compiling programs keep the frame from being held, the accumulation still', async () => {
  const { device } = fakeDevice();
  const chain = new EffectChain().add(effect.bloom());
  const rt = drawing(chain);
  const { revisions } = rt.run.gate,
    resources = revisions.resources;
  drawTwice(rt, device);
  assert.equal(rt.gpu.effects!.loading, true);
  assert.equal(unsettledMask(rt), 0, 'compiling moves nothing the accumulation reads');
  assert.equal(holdWebgpuFrame(rt, device), false, 'the image lacks the chain it will have');
  while (rt.gpu.effects!.loading) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(revisions.resources, resources, 'the arrival restarts no accumulation');
  assert.equal(holdWebgpuFrame(rt, device), false, 'the image drawn while compiling is redrawn');
  drawTwice(rt, device);
  assert.equal(holdWebgpuFrame(rt, device), true, 'drawn with the chain, the image is held');
});

test('an idle loop waits for the programs, then draws the image with the chain once (#349)', async (t) => {
  const { device } = fakeDevice();
  const made = WEBGPU_KINDS.bloom;
  t.after(() => void (WEBGPU_KINDS.bloom = made));
  let arrive = () => {};
  WEBGPU_KINDS.bloom = (gpu) => new Promise((done) => (arrive = () => done(made(gpu))));
  const chain = new EffectChain().add(effect.bloom());
  const rt = drawing(chain);
  const turn = () => new Promise((resolve) => setImmediate(resolve));
  const requested: FrameRequestCallback[] = [];
  const scheduler = createExplorerFrameScheduler({
    request: (callback) => requested.push(callback),
    cancel() {},
    // `renderWebgpuPages` reduced to its two outcomes: the frame held, or encoded and kept.
    render() {
      if (holdWebgpuFrame(rt, device)) return;
      rt.run.gpuDrawCalls = 2;
      encodeEffects(rt, device, encoder, input);
      rt.run.frame++;
      keepWebgpuFrame(rt);
    },
    pending: () => pendingWebgpuFrame(rt),
    error: (error) => assert.fail(String(error)),
    limited: () => assert.fail('the loop hit its frame limit'),
  });
  scheduler.invalidate();
  requested.shift()!(0);
  for (let i = 0; i < 4; i++) await turn();
  assert.equal(rt.gpu.effects!.loading, true);
  assert.equal(requested.length, 0, 'no frame is spent while the programs compile');
  arrive();
  while (rt.gpu.effects!.loading) await turn();
  await turn();
  assert.equal(requested.length, 1, 'their arrival asks the image with the chain');
  requested.shift()!(0);
  assert.equal(rt.gpu.effectsRevision, chain.revision, 'the image carries the chain');
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
  Object.assign(rt.run, { diagnostic: 'beauty' });
  rt.capture.capturing = true;
  assert.equal(encodeEffects(rt, device, encoder, input), input);
  assert.deepEqual([rt.gpu.effects, textures.length], [undefined, 0]);
  assert.equal(rt.gpu.effectsRevision, chain.revision, 'the revision drawn is kept all the same');
});
