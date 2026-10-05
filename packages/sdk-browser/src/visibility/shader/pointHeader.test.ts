// #831: a vertex stage decodes, per corner, only the header its row reads — corners and positions
// alone unless the row draws a line or a cutout (`pageHeaderFor`, `pageSurfaceRead`). The shadow
// stage hands its UV on to a masked row alone, the only one whose cutout reads it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { shaderRun } from '../../texture/shaderRun.fixture.ts';
import { type Fn } from './triangleScene.fixture.ts';
import { vsmRenderRasterWgsl } from '../../vsm/renderRasterWgsl.ts';
import { vsmLayout } from '../../vsm/resources.ts';
import * as F from '../types.ts';
import { ROWS } from './pointHeader.fixture.ts';

const VSM_CODE = vsmRenderRasterWgsl(vsmLayout({ fullMapCapacity: 63, poolPages: 256 }, 1 << 27));

// The shadow cutout of an unmasked row keeps every fragment before it reads a UV or a map: the
// UV its stage no longer hands on changes no texel of the pool.
test('an unmasked shadow caster keeps every fragment whatever its UV', () => {
  const fail = () => assert.fail('an unmasked row reads its cutout');
  const run = shaderRun<{ maskKeep: Fn }>(VSM_CODE, ['maskKeep'], {
    lineDash: fail,
    maskAlpha: fail,
  });
  for (const [flags] of ROWS.filter(([flags]) => !(flags & F.FLAG_MASK))) {
    const page = { flags: flags | F.FLAG_HAS_UV };
    assert.equal(run.maskKeep(page, [NaN, NaN], 1, [0, 0], [0, 0]), true);
  }
});
