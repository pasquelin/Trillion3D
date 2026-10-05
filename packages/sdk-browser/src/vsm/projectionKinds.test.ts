// A projection pass is compiled with the kinds of its lights (`VSM_PROJECTION_KINDS`), so that
// every light of the pass takes the branch its
// own kind takes, so it runs the one trace it ran with both compiled — the same mask word. The pass
// sets the kinds (`projectionOnePass.test.ts`). And the tile's light words start at 0 as WebGPU
// starts every workgroup variable: no store, no barrier for it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { functionText } from '../bounce/wgslBody.fixture.ts';
import { shaderRun } from '../texture/shaderRun.fixture.ts';
import { wgslConstants } from '../texture/shaderRule.fixture.ts';
import { vsmLayout } from './resources.ts';
import {
  VSM_LIGHT_KIND_DIRECTIONAL as DIRECTIONAL,
  VSM_LIGHT_KIND_POINT as POINT,
  VSM_LIGHT_KIND_RECT as RECT,
  VSM_LIGHT_KIND_SPOT as SPOT,
} from './constants.ts';
import {
  VSM_PROJECTION_KINDS_DIRECTIONAL as SUN,
  VSM_PROJECTION_KINDS_LOCAL as LAMP,
  vsmProjectionWgsl,
} from './projectionWgsl.ts';

const LAYOUT = vsmLayout({ fullMapCapacity: 127, sunMapCapacity: 35 }, 2 ** 27);
const CODE = vsmProjectionWgsl(LAYOUT, { subgroups: false });

test('each light of a pass takes its own kind branch, whatever kinds the pass is compiled with', () => {
  // [the pass's kinds, a light's kind among them, whether it is directional]: 0 is both compiled.
  const rows: [number, number, boolean][] = [
    [SUN, DIRECTIONAL, true],
    [LAMP, POINT, false],
    [LAMP, SPOT, false],
    [LAMP, RECT, false],
    ...[0, SUN | LAMP].flatMap((both) =>
      [DIRECTIONAL, POINT, SPOT, RECT].map((kind): [number, number, boolean] => [
        both,
        kind,
        kind === DIRECTIONAL,
      ]),
    ),
  ];
  for (const [kinds, kind, directional] of rows) {
    const { vsmLightIsDirectional } = shaderRun<{
      vsmLightIsDirectional: (light: { kind: number }) => boolean;
    }>(CODE, ['vsmLightIsDirectional'], { ...wgslConstants(CODE), VSM_PROJECTION_KINDS: kinds });
    assert.equal(vsmLightIsDirectional({ kind }), directional, `kinds ${kinds}, light ${kind}`);
  }
  // No branch of the region test or the trace reads the kind past it.
  const branches =
    functionText(CODE, 'vsmProjectLight') + functionText(CODE, 'vsmLightParticipates');
  assert.doesNotMatch(branches, /kind==LIGHT_KIND_DIRECTIONAL/);
});

test("the tile's light words start at 0 by WebGPU: no store of them", () => {
  const entry = functionText(vsmProjectionWgsl(LAYOUT, { subgroups: false }), 'vsmProjection');
  assert.doesNotMatch(entry, /atomicStore\(&vsmTileLights/);
});
