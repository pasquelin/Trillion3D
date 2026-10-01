// #1336: the WebGL2 impostor tier loads its code on first use, from the impostor family both
// renderers share, so the CDN core stays within its budget. A cache without baked impostors makes
// no tier; one with them plans no card until the code lands — every root keeps its clusters — and
// is asked a new image once it has, whose plan then asks the atlas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { families } from '../../host/families.ts';
import { createTestContext } from '../core/testContext.fixture.ts';
import {
  ATLAS_URLS,
  engineAt,
  impostorScene,
  impostorSection,
  VIEWPORT,
} from '../../impostor/section.fixture.ts';
import { webglImpostorTier } from './code.ts';

test('the WebGL2 tier is made by a baked cache only, and plans once its code has landed', async () => {
  const { fixture, roots, reader, asked } = impostorScene();
  let changed = 0;
  const gate = { resourcesChanged: () => void changed++ };
  const session = (impostors: unknown) =>
    ({
      metadata: { impostors },
      readTextureLevel: reader,
      webglContext: createTestContext().gl,
    }) as unknown as Parameters<typeof webglImpostorTier>[0];
  assert.equal(
    webglImpostorTier(session({ baked: 0 }), roots, gate, () => 1 << 20),
    undefined,
  );
  assert.equal(families.impostors.arrived, false, 'a cache without cards fetches nothing');
  const tier = webglImpostorTier(session(impostorSection), roots, gate, () => 1 << 20)!;
  tier.plan(engineAt(200), VIEWPORT);
  tier.plan(engineAt(200), VIEWPORT);
  assert.deepEqual(asked, [], 'no card and no atlas before the code lands');
  assert.equal(tier.cards(...([] as unknown as Parameters<typeof tier.cards>)), false);
  await families.impostors.settled();
  await Promise.resolve();
  assert.equal(changed, 1, 'one new image per round, however many images asked');
  tier.plan(engineAt(200), VIEWPORT);
  assert.deepEqual(
    asked.map((request) => request.url),
    ATLAS_URLS,
    'the landed tier plans and asks the atlas',
  );
  tier.dispose();
  fixture.geometry.dispose();
});
