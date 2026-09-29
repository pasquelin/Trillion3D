import test from 'node:test';
import assert from 'node:assert/strict';
import { mustRestartTaaAfterSettle, texturesConverged } from './converge.ts';
import { MAP_CHOICES, PICK_BLENDS, PICK_TAPS } from './feedback.ts';
import { FEEDBACK_RULE_WGSL, TILE_REQUEST_WGSL } from './requestWgsl.ts';
import { SHADE_REQUEST_WGSL } from '../../visibility/shader/request.ts';
import { BLEND_REQUEST_WGSL } from '../blend/requestWgsl.ts';
import { SHADOW_DEPTH_SHADER } from '../../gpu/shadow/shader.ts';

test('a quiet barrier leaves TAA history in place', () => {
  assert.equal(mustRestartTaaAfterSettle(0, 0), false);
});

test('tiles or shadow pages that landed during the barrier restart the still TAA average', () => {
  assert.equal(mustRestartTaaAfterSettle(1, 0), true);
  assert.equal(mustRestartTaaAfterSettle(0, 3), true);
});

// #1016: a pixel named ONE map, blend level and tap, picked by its position. A sliver of a
// surface — three pixels at the edge of a lamp — named nothing it reads, and the settled image
// read what the pool kept of the run before. A convergence image now runs through every pick of
// every pixel and names the first whose tile the table does not hold at its level.
test('a convergence image names, per pixel, the first of all its picks whose tile is missing', () => {
  const pick = (px: number, choices: number) => [
    px % choices,
    Math.floor(px / choices) & (PICK_BLENDS - 1),
    Math.floor(px / choices / PICK_BLENDS) % PICK_TAPS,
  ];
  for (const choices of [1, MAP_CHOICES, MAP_CHOICES + 1])
    for (const px of [0, 7, 1280 + 719]) {
      const named = new Set<string>();
      for (let turn = 0; turn < choices * PICK_BLENDS * PICK_TAPS; turn++)
        named.add(pick(px + turn, choices).join());
      assert.equal(named.size, choices * PICK_BLENDS * PICK_TAPS, `pixel ${px}, ${choices} maps`);
    }
  assert.match(FEEDBACK_RULE_WGSL, /const PICK_TURNS:u32=6u;/);
  assert.match(
    FEEDBACK_RULE_WGSL,
    /fn everyPick\(pos:vec2f,choices:u32,turn:u32\)[^\n]*pickOf\(u32\(pos\.x\)\+u32\(pos\.y\)\+turn,choices\)/,
  );
  assert.match(
    TILE_REQUEST_WGSL,
    /if\(missing&&word!=0u&&\(\(word>>24u\)&0x7fu\)==level\)\{return 0u;\}/,
  );
  for (const [name, text, choices] of [
    ['shade', SHADE_REQUEST_WGSL, 'choices'],
    ['blend', BLEND_REQUEST_WGSL, 'MAP_CHOICES'],
  ]) {
    const loop = new RegExp(
      `if\\(feedbackEvery\\(uni\\.feedback\\)\\)\\{\\n  for\\(var turn=0u;turn<${choices}\\*PICK_TURNS;turn\\+\\+\\)\\{\\n` +
        `   let rank=\\w+\\([^;]*everyPick\\([^;]*,${choices},turn\\),true,[^;]*;\\n   if\\(rank!=0u\\)\\{return rank;\\}`,
    );
    assert.match(text, loop, `${name}: every pick, the first missing`);
    assert.match(
      text,
      /requestPick\([^;]*,uni\.feedback\),false,/,
      `${name}: its own pick otherwise`,
    );
  }
  assert.match(
    SHADOW_DEPTH_SHADER,
    /for\(var turn=0u;turn<2u;turn\+\+\)\{cutoutPost\([^;]*everyPick\(in\.position\.xy,1u,turn\)\);\}/,
  );
});

// #1016 review: the barrier converged only at the jitter of the image it replays; the still
// frames average eight others, whose slivers named tiles that landed during the average, when
// the readback happened to come back. A capture's barrier converges a whole round of phases.
test("a capture's convergence stops on a quiet round of the still phases, closing on the replayed one", () => {
  assert.equal(texturesConverged(7, 8, 6, 0, false), false, 'a phase not yet heard');
  assert.equal(texturesConverged(8, 8, 7, 0, false), true);
  assert.equal(
    texturesConverged(9, 8, 8, 0, false),
    false,
    'the next image is not the replayed one',
  );
  assert.equal(texturesConverged(8, 8, 15, 0, false), true);
  assert.equal(texturesConverged(8, 8, 7, 2, true), false, 'a level still read is waited for');
  assert.equal(texturesConverged(1, 1, 0, 0, false), true, 'no accumulation: one quiet image');
});
