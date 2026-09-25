// #364: a sprite is the reference's `Sprite` — a unit square every raster turns to the camera, its
// picture placed on its origin by `center`, its material a see-through picture with `rotation`
// and `sizeAttenuation`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { object, Sprite } from './index.ts';
import { material } from '../material/index.ts';
import { drawnTriangles } from '../geometry/drawn.ts';
import type { Material } from '../material/material.ts';

test('object.sprite is a Sprite centred on its origin, in a see-through sprite material', () => {
  const sprite = object.sprite();
  assert.ok(sprite instanceof Sprite);
  assert.equal(sprite.isSprite, true);
  assert.equal(sprite.primitive, 'sprite');
  assert.deepEqual([sprite.center.x, sprite.center.y], [0.5, 0.5]);
  const matter = material.sprite();
  assert.equal(matter.rotation, 0);
  assert.equal(matter.sizeAttenuation, true);
  assert.equal(matter.transparent, true, "the reference's SpriteMaterial is transparent");
  assert.equal(material.sprite({ transparent: false }).transparent, false);
});

test("a sprite's quad is moved by its centre about its origin, and bounded by its radius", () => {
  const sprite = object.sprite();
  const middle = drawnTriangles(sprite.geometry, 'sprite')!;
  assert.equal(middle.spriteRadius, Math.SQRT1_2);
  const corner = drawnTriangles(sprite.geometry, 'sprite', { center: [0, 0] })!;
  const xs = Array.from(corner.positions).filter((_, i) => i % 3 === 0);
  const ys = Array.from(corner.positions).filter((_, i) => i % 3 === 1);
  // The picture's bottom-left corner sits on the origin: the quad spans [0, 1] on both axes.
  assert.deepEqual([Math.min(...xs), Math.max(...xs)], [0, 1]);
  assert.deepEqual([Math.min(...ys), Math.max(...ys)], [0, 1]);
  assert.equal(corner.spriteRadius, Math.SQRT2);
  assert.equal(drawnTriangles(sprite.geometry, 'triangles')!.spriteRadius, undefined);
});

test('a moved centre reaches the world, and a clone keeps it', () => {
  const sprite = object.sprite(material.sprite({ rotation: 0.3 }));
  const heard: unknown[] = [];
  sprite._link = {
    content: (node: unknown) => heard.push(node),
    pose: () => {},
    structure: () => {},
  } as unknown as typeof sprite._link;
  sprite.center.set(0.5, 0);
  assert.deepEqual(heard, [sprite]);
  sprite._link = null;
  for (const copy of [sprite.clone(), object.clone(sprite)!]) {
    assert.ok(copy instanceof Sprite);
    assert.deepEqual([copy.center.x, copy.center.y], [0.5, 0]);
    assert.equal((copy.material as Material).rotation, 0.3);
  }
});

test('a sprite wears only a sprite material, as the reference Sprite takes a SpriteMaterial', () => {
  const kind = /A sprite wears a material\.sprite, not material\.meshStandard\./;
  assert.throws(() => object.sprite(material.meshStandard()), kind);
  const sprite = object.sprite();
  assert.throws(() => (sprite.material = material.meshStandard()), kind);
  assert.throws(() => (sprite.material = [material.sprite()]), /not a material list/);
  const picture = material.sprite({ rotation: 1 });
  sprite.material = picture;
  assert.equal(sprite.material, picture);
});
