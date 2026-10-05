// #364: a sprite casts no shadow. Its root carries `SPRITE_ROOT`, so the shadow raster leaves its
// rows out (`../../webgpu/shadow/bounds.ts`, `MOBILITY_SHADOWLESS`). Every other surface casts.
// #456: a mesh set `castShadow = false` is left out the same way.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dagFixture } from '../../page/selection/dag.fixture.ts';
import { packed } from '../../gpu/dag/selectionHelpers.fixture.ts';
import { CASTS_NO_SHADOW } from './spriteWgsl.ts';

/** The test DAG, worn as a sprite when `sizeAttenuation` is given. */
function surfaceFixture(sizeAttenuation?: boolean) {
  const fixture = dagFixture();
  if (sizeAttenuation !== undefined)
    Object.assign(fixture.mesh.material, { sprite: true, rotation: 0, sizeAttenuation });
  return fixture;
}

/** True when the fixture's one root carries a bit the shadow raster leaves out. */
function castsNone(fixture: ReturnType<typeof dagFixture>) {
  const { roots } = packed(fixture);
  fixture.geometry.dispose();
  return ((roots[0].mark ?? 0) & CASTS_NO_SHADOW) !== 0;
}

test('a sprite, attenuated or not, casts no shadow, every other surface does', () => {
  assert.equal(castsNone(surfaceFixture()), false, 'a surface that is no sprite still casts');
  for (const sizeAttenuation of [true, false])
    assert.equal(castsNone(surfaceFixture(sizeAttenuation)), true);
});

test('a mesh set to cast no shadow casts none', () => {
  const fixture = dagFixture();
  assert.equal(fixture.mesh.castShadow, true, 'a mesh casts unless it says otherwise');
  fixture.mesh.castShadow = false;
  assert.equal(castsNone(fixture), true);
});
