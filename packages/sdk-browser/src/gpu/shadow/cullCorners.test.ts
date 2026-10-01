// #966 (OMB-26): a region's two commands draw as many corners as the largest caster each keeps,
// not the scene's largest cluster: every kept caster's triangles, and never more vertices than
// before. The shaders cannot run under node: their lines are pinned, and the commands they build
// are replayed on the mobility words the host writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DRAW_INDIRECT_WORDS } from '../draw/contract.ts';
import { SHADOW_REGION_COMMANDS, emptyRegionCommands } from './batchBudget.ts';
import {
  MOBILITY_COARSER,
  MOBILITY_CORNER_SHIFT,
  MOBILITY_CUTOUT,
  SHADOW_CULL_SHADER,
  SHADOW_LIGHT_CULL_SHADER,
} from './cullShader.ts';
import { SHADOW_OCCLUSION_SHADER } from './occlusionShader.ts';
import { createShadowMobility } from '../../webgpu/shadow/mobility.ts';
import { seeded } from '../../../../../site/examples/kit/random.ts';

test('both culls raise the command to the corners of each caster they keep', () => {
  const line = `let corners=word>>${MOBILITY_CORNER_SHIFT}u;\n if(atomicLoad(&indirect[keptCorners(face,cutout)])<corners){atomicMax(&indirect[keptCorners(face,cutout)],corners);}`;
  for (const shader of [SHADOW_CULL_SHADER, SHADOW_LIGHT_CULL_SHADER])
    assert.ok(shader.includes(line));
  assert.ok(
    SHADOW_OCCLUSION_SHADER.includes(
      'if(id.x==0u){for(var list=0u;list<2u;list++){atomicStore(&visibleIndirect[keptCorners(r,list==1u)],indirect[keptCorners(r,list==1u)]);}}',
    ),
    'a visible list draws the corners of the list it comes from',
  );
  const empty = emptyRegionCommands(3);
  assert.equal(empty.length, 3 * SHADOW_REGION_COMMANDS * DRAW_INDIRECT_WORDS);
  assert.ok(
    empty.every((word) => word === 0),
    'zero instances of zero vertices',
  );
});

test("a region's vertex count is its largest kept caster's: all their triangles, never more", () => {
  const random = seeded(966),
    rows = 64;
  // Clusters of 1 to 128 triangles; a quarter cutouts, drawn from the second list.
  const corners = Array.from({ length: rows }, () => 3 * (1 + Math.floor(random() * 128)));
  const cutout = Array.from({ length: rows }, () => random() < 0.25);
  const sceneMax = Math.max(...corners);
  const mobility = createShadowMobility();
  mobility.ensure(1, rows, () => new Float64Array(16));
  const at = (row: number) => corners[row];
  mobility.writeRows(
    () => 0,
    rows,
    0,
    rows - 1,
    () => {},
    at,
    rows,
    (row) => cutout[row],
  );
  for (let region = 0; region < 200; region++) {
    const kept = Array.from({ length: rows }, (_, row) => row).filter(() => random() < 0.2);
    for (const list of [false, true]) {
      // `keepCaster`: the command starts at zero corners and takes the max of each kept word's.
      const words = kept.map((row) => mobility.rowWords[row]);
      const own = words.filter((word) => ((word & MOBILITY_CUTOUT) !== 0) === list);
      const vertexCount = own.reduce(
        (most, word) => Math.max(most, word >>> MOBILITY_CORNER_SHIFT),
        0,
      );
      const expected = kept.filter((row) => cutout[row] === list).map(at);
      assert.equal(vertexCount, Math.max(0, ...expected));
      assert.ok(
        expected.every((count) => count <= vertexCount),
        'every kept triangle drawn',
      );
      assert.ok(vertexCount <= sceneMax, 'never more vertex invocations than before');
    }
  }
});

test('edge cases: an empty list draws nothing; zero, one-triangle and maximal casters keep their count', () => {
  const corners = [0, 3, 384, 2 ** (32 - MOBILITY_CORNER_SHIFT) - 1];
  const mobility = createShadowMobility();
  mobility.ensure(1, corners.length, () => new Float64Array(16));
  const at = (row: number) => corners[row];
  mobility.writeRows(
    () => 0,
    corners.length,
    0,
    corners.length - 1,
    () => {},
    at,
    corners.length,
  );
  const drawn = (rows: number[]) =>
    rows.reduce((most, row) => Math.max(most, mobility.rowWords[row] >>> MOBILITY_CORNER_SHIFT), 0);
  assert.equal(drawn([]), 0, 'no kept caster: zero vertices, as begin wrote');
  corners.forEach((count, row) => assert.equal(drawn([row]), count));
  assert.equal(drawn([0, 1, 2]), 384);
  assert.equal(mobility.rowWords[3] & MOBILITY_CUTOUT, 0, 'the count never reaches the flag bits');
});

test('a row a finer resident form stands for is marked coarser, its corners kept (#831)', () => {
  const mobility = createShadowMobility();
  mobility.ensure(1, 4, () => new Float64Array(16));
  const coarser = (row: number) => row === 1 || row === 3;
  mobility.writeRows(
    () => 0,
    4,
    0,
    3,
    () => {},
    () => 384,
    3,
    undefined,
    coarser,
  );
  const marked = [...mobility.rowWords].map((word) => word & MOBILITY_COARSER);
  assert.deepEqual(marked, [0, MOBILITY_COARSER, 0, 0], 'row 3, a blended one, stays drawn');
  assert.equal(mobility.rowWords[1] >>> MOBILITY_CORNER_SHIFT, 384);
});
