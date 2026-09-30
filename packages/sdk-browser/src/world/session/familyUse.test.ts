import test from 'node:test';
import assert from 'node:assert/strict';
import { ParticlePool } from '../../../../sdk-core/src/fluids/particles.ts';
import { EffectChain } from '../../../../sdk-core/src/world/effect/chain.ts';
import { effect } from '../../../../sdk-core/src/world/effect/index.ts';
import { createGuideSet } from '../../guides/guideSet.ts';
import { families } from '../../host/families.ts';
import { frameQueue } from '../render/frameQueue.fixture.ts';
import { frameFamilies, frameWaits, sessionFamilies } from './familyUse.ts';
import { startInteractiveExplorer } from './interactive.ts';

const turn = () => new Promise((wake) => setImmediate(wake));

test('a plain frame draws with no family; pools, passes, guides, views and A/B name theirs', () => {
  const guides = createGuideSet();
  const held = { particles: [], effects: new EffectChain(), guides };
  assert.deepEqual(frameFamilies(held, 'beauty'), []);
  held.particles = [new ParticlePool({ capacity: 4 })] as never;
  held.effects.add(effect.bloom());
  const line = guides.lines({ positions: [0, 0, 0, 1, 0, 0] });
  assert.deepEqual(frameFamilies(held, 'wireframe'), [
    'particles',
    'effects',
    'guides',
    'diagnostics',
  ]);
  line.setVisible(false);
  assert.ok(!frameFamilies(held, 'beauty').includes('guides'), 'a hidden guide draws nothing');
  assert.ok(frameFamilies(held, 'beauty', true).includes('measurement'), 'an A/B layout');
});

test("a session's own loop: the frame waits for its pools' code, neither stepped nor drawn (#1353)", async () => {
  const held = { particles: [new ParticlePool({ capacity: 4 })] };
  const frames = frameQueue(),
    done: string[] = [];
  const listeners = { addEventListener() {}, removeEventListener() {} };
  const view = {
    ...listeners,
    requestAnimationFrame: frames.request,
    cancelAnimationFrame: frames.cancel,
    matchMedia: () => listeners,
    devicePixelRatio: 1,
  };
  const canvas = { clientWidth: 4, clientHeight: 4, ownerDocument: { defaultView: view } };
  const runtime = {
    canvas,
    options: { width: 4, height: 4, pixelRatio: 1 },
    hostedControls: [],
    state: { disposed: false },
    familiesPending: () => frameWaits(held, 'beauty'),
    // As the host runtime answers (`hostRuntime.ts`): the frame that waited draws on arrival.
    pendingFrame: async () => !!(await frameWaits(held, 'beauty')?.then(() => true)),
    landings: () => undefined,
  };
  const explorer = { render: () => (done.push('draw'), {}), resize() {} };
  const config = { ownControls: false, pixelRatio: 1, beforeFrame: () => done.push('step') };
  const events = { emit() {}, diagnose() {} };
  startInteractiveExplorer(explorer as never, runtime as never, config, events);
  assert.deepEqual(done, [], 'the first frame waits');
  assert.ok(frames.run());
  assert.deepEqual(done, [], 'and the next one, the code still on its way');
  await families.particles.settled();
  await turn();
  assert.ok(frames.run(), 'its arrival asks the frame');
  assert.deepEqual(done, ['step', 'draw'], 'stepped from nothing, then drawn with its pools');
});

test("a session opens with its first frame's families, and the provenance only when heard", async () => {
  assert.equal(sessionFamilies({}, false), undefined, 'a plain session waits for nothing');
  await families.measurement.settled();
  assert.equal(families.measurement.arrived, false, 'nothing fetched it');
  await sessionFamilies({}, true);
  assert.equal(families.measurement.get()?.SDK_BUILD_PROVENANCE.version, 1);
});
