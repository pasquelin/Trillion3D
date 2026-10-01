// #1336: on WebGL2, a root the impostor plan switches draws its card — the shared plan and card of
// WebGPU (`impostor/cards.ts`), read through the engine's one held-level read — through the card
// program, in the cluster program's own pass, and its card bit leaves it to the card in the CPU
// cut while the light cuts keep its shadow: plan and draw agree. Until its atlas is made the root
// keeps its clusters. Fails on develop: the WebGL2 card draw is new.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestContext } from '../core/testContext.fixture.ts';
import { WebglClusterRenderer } from '../cluster/renderer.ts';
import { readDegraded } from '../cluster/validation.ts';
import { createHostDrawCamera, readHostDrawCamera } from '../../camera/world.ts';
import { frontCamera } from '../../page/selection/dag.fixture.ts';
import { impostorCardCorners } from '../../impostor/card.ts';
import { CARD_ROOT } from '../../visibility/shader/spriteWgsl.ts';
import { castsNoShadow } from '../../page/cut/select.ts';
import {
  ATLAS_URLS,
  cutAt,
  engineAt,
  impostorScene,
  impostorSection,
  settle,
  VIEWPORT,
} from '../../impostor/section.fixture.ts';
import { createWebglImpostors } from './frame.ts';
import * as lent from './lent.ts';
import { CARD_FLOATS } from '../../impostor/cards.ts';

/** A WebGL2 session reduced to what the plan and the draw read, on a recording context. */
function bench() {
  const context = createTestContext({ answers: { getExtension: () => ({}) } });
  const { fixture, roots, reader, asked } = impostorScene();
  let landed = 0;
  const session = {
    metadata: { impostors: impostorSection },
    readTextureLevel: reader,
    webglContext: context.gl,
    onDiagnostic: () => undefined,
  } as unknown as Parameters<typeof createWebglImpostors>[1];
  const gate = { resourcesChanged: () => void landed++ };
  const impostors = createWebglImpostors(lent, session, roots, gate, () => 1 << 20)!;
  const renderer = new WebglClusterRenderer(
    context.gl,
    readDegraded(() => {}),
  );
  renderer.cards = impostors.cards;
  /** Draws one image seen from `z` through the cluster renderer. */
  const draw = (z: number) => {
    const camera = readHostDrawCamera(createHostDrawCamera(), frontCamera(z, 5000));
    renderer.draw([], { lights: [] }, camera, true, true);
  };
  return { context, fixture, roots, asked, impostors, draw, landed: () => landed };
}

test('a switched root draws its card on WebGL2 once its atlas is made', async () => {
  const { context, fixture, roots, asked, impostors, draw, landed } = bench();
  // First image: the atlas is asked through the one reader, and the root keeps its clusters.
  impostors.plan(engineAt(200), VIEWPORT);
  assert.equal(roots[0].mark, undefined, 'no card before the atlas: the root stays whole');
  assert.ok(cutAt(roots, 200).shown.length > 0, 'no hole while the atlas streams');
  assert.deepEqual(
    asked.map((request) => request.url),
    ATLAS_URLS,
  );
  await settle();
  assert.ok(landed() >= 1, 'the landing breaks a held image');
  // The image that finds the levels makes the atlas and switches the root.
  impostors.plan(engineAt(200), VIEWPORT);
  const formats = context.of('texStorage2D').map((args) => args[2]);
  assert.deepEqual(formats, ['SRGB8_ALPHA8', 'RGBA8', 'RGBA8'], 'colour sRGB, data linear');
  assert.equal(roots[0].mark, CARD_ROOT, 'the switch marks the root');
  assert.deepEqual(cutAt(roots, 200).shown, [], 'the CPU cut leaves it to its card');
  assert.equal(castsNoShadow(roots[0].mark, {}), false, 'its light cuts keep its shadow');
  const { state } = impostors;
  assert.equal(state.count, 1);
  // The card's corners are the shared sprite basis at the root's pivot, half-extent R.
  const corners = impostorCardCorners(
    new Float64Array(12),
    engineAt(200).viewProjection,
    [0, 0, 0],
    1,
  );
  for (let i = 0; i < 4; i++)
    for (let k = 0; k < 3; k++)
      assert.ok(Math.abs(state.records[i * 4 + k] - corners[i * 3 + k]) < 1e-5, `corner ${i}`);
  // The draw: the card program, from the cluster fragment with its surface read replaced.
  const from = context.calls.length;
  draw(200);
  const calls = context.calls.slice(from);
  const sources = context.of('shaderSource').map((args) => String(args[1]));
  assert.ok(sources.some((text) => text.includes('gl_InstanceID') && text.includes('impView(')));
  const fragment = sources.find((text) => text.includes('impBlend(') && text.includes('shade('));
  assert.ok(fragment?.includes('gl_FragDepth'), 'the depth where the mesh would be');
  const draws = calls.filter((call) => call.name === 'drawArraysInstanced');
  assert.deepEqual(
    draws.map((call) => call.args),
    [['TRIANGLES', 0, 6, 1]],
    'one quad, one card',
  );
  // Its atlas bound before the draw, its record sent, the cluster program bound again after.
  const at = calls.indexOf(draws[0]);
  const bound = calls.slice(0, at).filter((call) => call.name === 'bindTexture');
  for (const texture of state.runs[0].group)
    assert.ok(
      bound.some((call) => call.args[1] === texture),
      "the mesh's atlas bound",
    );
  const sent = calls.find(
    (call) => call.name === 'texSubImage2D' && call.args[8] instanceof Float32Array,
  );
  assert.deepEqual(
    (sent?.args[8] as Float32Array).subarray(0, CARD_FLOATS),
    state.records.subarray(0, CARD_FLOATS),
  );
  const programs = calls.filter((call) => call.name === 'useProgram').map((call) => call.args[0]);
  const after = calls.slice(at).find((call) => call.name === 'useProgram');
  assert.equal(after?.args[0], programs[0], 'the cluster program draws on');
  fixture.geometry.dispose();
  impostors.dispose();
});

test('a near root draws whole again and no card is drawn', async () => {
  const { context, fixture, roots, impostors, draw } = bench();
  impostors.plan(engineAt(200), VIEWPORT);
  await settle();
  impostors.plan(engineAt(200), VIEWPORT);
  assert.equal(roots[0].mark, CARD_ROOT);
  impostors.plan(engineAt(5), VIEWPORT);
  assert.equal(roots[0].mark, undefined, 'its card bit cleared');
  assert.ok(cutAt(roots, 5).shown.length > 0);
  draw(5);
  assert.deepEqual(context.of('drawArraysInstanced'), [], 'no card, no draw');
  fixture.geometry.dispose();
  impostors.dispose();
});
