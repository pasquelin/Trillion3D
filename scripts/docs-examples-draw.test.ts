import assert from 'node:assert/strict';
import test from 'node:test';
import { DECLARED_ERRORS, leastDrawn, SPARSE } from './docs/examples/capture.ts';
import { examplePages, parkedExampleIds } from './docs/examples/pages.ts';
import { physicsExamples, turnsPhysicsOn } from './docs/examples/physics.ts';
import { readyEntries as ready } from '../site/app/examples/list.ts';

// #527: what left an example blank or stopped in the examples proof, read from the files.
const pages = await examplePages();

test('a readout is declared after the controls panel it joins', () => {
  for (const { file, html } of pages) {
    const readout = html.search(/\b(?:readout|physicsReadouts)\(/);
    if (readout < 0) continue;
    const panel = html.search(/\bcontrols\(/);
    assert.ok(panel >= 0 && panel < readout, `${file}: readout before controls`);
  }
});

test('no example prints a physics line by hand; each asks the kit for it', () => {
  for (const { file, html } of pages)
    assert.doesNotMatch(html, /physics\.stats|readout\('(?:bodies|awake|step|page)'\)/, file);
});

test('only a parked page declares an error, never a 404 nor an engine failure (#945)', () => {
  const ids = new Set(pages.map(({ id }) => id));
  for (const { page, error, why } of DECLARED_ERRORS) {
    assert.ok(ids.has(page) && parkedExampleIds.has(page) && why, page);
    // The engine's failures (`worldHandles.ts`, `interactive.ts`, `lost.ts`) and a resource
    // Chrome could not load, the icon every page asks for included, are always heard.
    assert.doesNotMatch(error, /^(?:World session failed|\[trillion3d\]|Failed to load resource)/);
  }
});

test('a sparse example is declared by name and backend under the tenth; every other keeps the tenth', () => {
  const ids = new Set(ready.map(({ id }) => id));
  for (const [id, { share }] of Object.entries(SPARSE)) {
    assert.ok(ids.has(id), id);
    assert.ok(share > 0 && share < 0.1, id);
  }
  // The shares declared under those measured on 2026-09-24, and the examples never declared: the
  // three a refused WebGL2 session left blank, save-the-scene, whose ground fills its frame
  // (#717), and click-to-pick, framed closer (#527). They keep the tenth on both backends.
  const named = [
    'a-staircase-from-one-step',
    'a-cloud-of-points',
    'save-the-scene',
    'shapes-on-a-turntable',
    'fly-over-a-model-town',
    'from-a-grain-to-a-planet',
    'snow-of-sprites',
    'click-to-pick',
  ];
  for (const id of named) assert.ok(ids.has(id), id);
  // A new declaration is asserted here too, with its literal share.
  for (const id of Object.keys(SPARSE)) assert.ok(named.includes(id), id);
  const least = (gpu: boolean) => named.map((id) => leastDrawn(id, gpu));
  assert.deepEqual(least(false), [0.04, 0.04, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1]);
  assert.deepEqual(least(true), [0.04, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1]);
});

test('the proof expects Jolt from the pages whose own source turns physics on, and from no other', async () => {
  assert.ok(turnsPhysicsOn("createWorld('view', { controls: 'orbit', physics: true })"));
  assert.ok(turnsPhysicsOn("createWorld('view', { physics: { gravity: 'moon' } })"));
  assert.ok(turnsPhysicsOn("createWorld('view', { size: fit(1, 2), physics: true })"));
  assert.ok(turnsPhysicsOn('world.physics.enabled = true;'));
  assert.ok(!turnsPhysicsOn('  // world.physics.enabled = true;'));
  assert.ok(!turnsPhysicsOn("createWorld('view', { physics: false })"));
  assert.ok(!turnsPhysicsOn("createWorld('view', { 'physics': undefined })"));
  assert.ok(turnsPhysicsOn("createWorld('view', { size: fit(at(1), 2), physics: true })"));
  assert.ok(!turnsPhysicsOn("createWorld('view', { controls: 'orbit' }); // physics: true"));
  assert.ok(!turnsPhysicsOn("createWorld('physics', { controls: 'orbit' })"));
  assert.ok(!turnsPhysicsOn("createWorld('view', {\n  controls: 'orbit', // no physics\n})"));
  assert.ok(!turnsPhysicsOn("createWorld('view', { physics: false, ready: () => w.physics })"));
  // #503: a ready page that sets a body or reads the world's physics is one that turns it on,
  // `ride-a-roller-coaster` (#634) included, which the hand-kept list the derivation replaced
  // missed; a page with no physics is left out.
  const sources = new Map(pages.map(({ file, html }) => [file, html]));
  const physics = await physicsExamples(ready);
  const used = ready
    .filter(({ file }) => /\.physics\b/.test(sources.get(file) ?? assert.fail(file)))
    .map(({ id }) => id);
  assert.deepEqual([...physics].sort(), used.sort());
  for (const id of ['ride-a-roller-coaster', 'falling-boxes']) assert.ok(physics.has(id), id);
  assert.ok(!physics.has('shapes-on-a-turntable'));
});
