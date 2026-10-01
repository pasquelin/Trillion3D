import assert from 'node:assert/strict';
import test from 'node:test';
import { addLabel } from './index.ts';
import { object } from '../../../../sdk-core/src/world/object/index.ts';
import type { Material } from '../../../../sdk-core/src/world/material/material.ts';
import { isHelper } from '../helper/mark.ts';
import { hostSurface } from '../core/worldSurface.ts';
import { GraphTexture } from '../../host/graph/texture.ts';
import { importHostSurface } from '../../host/surfaceImport.ts';
import { drawnTriangles } from '../../../../sdk-core/src/world/geometry/drawn.ts';
import { LABEL_FONT, glyphPixels, labelCanvas, labelTexture } from './canvas.fixture.ts';

test('a scene label carries actual glyph pixels and sprite draw data through the shared material path', async (t) => {
  labelCanvas(t);
  const parent = object.group();
  const label = await addLabel(parent, {
    text: 'A',
    font: LABEL_FONT,
    position: [1, 2, 3],
    height: 2,
  });
  const sprite = label.object;
  const paint = sprite.material as Material;
  const surface = hostSurface(paint, false, new Map(), 'sprite');
  assert.equal(sprite.parent, parent);
  assert.equal(isHelper(sprite), true);
  assert.deepEqual(sprite.position.toArray(), [1, 2, 3]);
  assert.deepEqual(sprite.center.toArray(), [0.5, 0]);
  assert.equal(sprite.castShadow, false);
  assert.equal(paint.depthTest, true);
  assert.equal(paint.depthWrite, false);
  assert.equal(paint.transparent, true);
  assert.deepEqual(importHostSurface(surface)?.sprite, { rotation: 0, sizeAttenuation: true });
  assert.ok(surface.map instanceof GraphTexture);
  const data = glyphPixels(surface.map.image);
  assert.ok(
    data.alpha.some((value) => value > 0),
    'real glyph strokes reach the draw texture',
  );
  assert.ok(
    data.alpha.some((value) => value > 0 && value < 255),
    'glyph edges are antialiased',
  );
  assert.equal(data.alpha[0], 0, 'the background is transparent');
  assert.equal(sprite.scale.x / sprite.scale.y, data.width / data.height);
  const triangles = drawnTriangles(sprite.geometry, 'sprite', { center: [0.5, 0] })!;
  assert.equal(triangles.indices.length, 6);
  assert.ok(triangles.uvs?.length, 'both renderers receive texture coordinates');
  const version = labelTexture(label).version;
  await label.setText('A');
  assert.equal(labelTexture(label).version, version, 'unchanged text does no upload');
  sprite.scale.set(4, 5, 6);
  await label.setText('B\nC');
  assert.equal(labelTexture(label).version, version + 1);
  const after = glyphPixels(labelTexture(label).image);
  assert.notDeepEqual(after.alpha, data.alpha);
  assert.equal(sprite.scale.y, 5);
  assert.equal(sprite.scale.z, 6);
  assert.equal(sprite.scale.x, (4 * (after.width / after.height)) / (data.width / data.height));
  assert.ok(after.height > data.height, 'newlines are separate glyph rows');
  assert.ok(after.alpha.slice(after.alpha.length / 2).some((value) => value > 0));
  label.remove();
  label.remove();
  assert.equal(parent.children.length, 0);
  await assert.rejects(label.setText('gone'), /removed/);
});

test('font readiness, concurrent edits and removal never publish stale glyphs', async (t) => {
  const pending = new Map<string, () => void>();
  labelCanvas(t, (_font, text) => new Promise<void>((resolve) => pending.set(text, resolve)));
  const parent = object.group();
  const opening = addLabel(parent, { text: 'first', font: LABEL_FONT });
  assert.equal(parent.children.length, 0, 'no fallback-font object is attached');
  pending.get('first')!();
  const label = await opening;
  const first = glyphPixels(labelTexture(label).image);
  const older = label.setText('older');
  const newer = label.setText('newer');
  pending.get('newer')!();
  await newer;
  const current = glyphPixels(labelTexture(label).image);
  pending.get('older')!();
  await older;
  assert.deepEqual(glyphPixels(labelTexture(label).image), current);
  assert.notDeepEqual(current, first);
  const discarded = label.setText('discarded');
  label.remove();
  pending.get('discarded')!();
  await discarded;
  assert.equal(parent.children.length, 0);
  assert.equal((labelTexture(label).image as { width: number }).width, 1);
});

test('invalid sizes and text larger than the declared canvas budget are refused without attaching', async (t) => {
  labelCanvas(t);
  const parent = object.group();
  for (const height of [0, -1, NaN, Infinity])
    await assert.rejects(addLabel(parent, { text: 'A', height }), RangeError);
  await assert.rejects(addLabel(parent, { text: 'A', position: [0, NaN, 0] }), RangeError);
  await assert.rejects(addLabel(parent, { text: 'A', font: '' }), TypeError);
  await assert.rejects(
    addLabel(parent, { text: 'W'.repeat(2048), font: LABEL_FONT }),
    /side limit/,
  );
  assert.equal(parent.children.length, 0);
  const empty = await addLabel(parent, { text: '', font: LABEL_FONT });
  assert.ok(glyphPixels(labelTexture(empty).image).alpha.every((v) => v === 0));
  empty.remove();
});

test('a refused font leaves the scene and an existing label unchanged', async (t) => {
  let refuse = false;
  const failure = new Error('Font request failed');
  labelCanvas(t, async () => {
    if (refuse) throw failure;
  });
  const parent = object.group();
  const label = await addLabel(parent, { text: 'safe', font: LABEL_FONT });
  const before = glyphPixels(labelTexture(label).image);
  refuse = true;
  await assert.rejects(label.setText('refused'), (error) => error === failure);
  assert.deepEqual(glyphPixels(labelTexture(label).image), before);
  await assert.rejects(
    addLabel(parent, { text: 'refused', font: LABEL_FONT }),
    (error) => error === failure,
  );
  assert.deepEqual(parent.children, [label.object]);
  label.remove();
});

test('opening snapshots mutable options before waiting for its font', async (t) => {
  let ready!: () => void;
  let wait = true;
  labelCanvas(t, () =>
    wait
      ? new Promise<void>((resolve) => {
          ready = resolve;
        })
      : Promise.resolve(),
  );
  const position: [number, number, number] = [1, 2, 3];
  const color = { r: 0.2, g: 0.3, b: 0.4 };
  const options = { text: 'before', font: LABEL_FONT, position, color };
  const opening = addLabel(object.group(), options);
  options.text = 'after';
  position[0] = NaN;
  color.r = 0.9;
  wait = false;
  ready();
  const label = await opening;
  assert.deepEqual(label.object.position.toArray(), [1, 2, 3]);
  assert.equal((label.object.material as Material).color.r, 0.2);
  const before = glyphPixels(labelTexture(label).image);
  await label.setText('after');
  assert.notDeepEqual(glyphPixels(labelTexture(label).image), before);
  label.remove();
});
