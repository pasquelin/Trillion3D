import test from 'node:test';
import assert from 'node:assert/strict';
import { hizLevelSizes } from './oracle.ts';
import { HIZ_SHADER } from './shader.ts';
import { hizBuildPasses, hizBuildSlots } from './uniforms.ts';
import {
  buildAfter,
  buildBefore,
  layout,
  LEVEL_CAP,
  type Scene,
} from './buildTranscripts.fixture.ts';

// The pyramid used to be a copy of the level-0 texture then one dispatch per mip, each reading
// the level above from the buffer. `buildHiz` reads the texture once, copies it on the way and
// reduces four mips per dispatch through workgroup memory. Below, both transcribed line by line,
// driven by the uniform words the host really writes, must leave the pyramid buffer identical
// bit for bit — every texel written, no other — on random sizes, capped mip counts, several
// pyramids per dispatch, and NaN, ±0, ±Inf depths.

const SPECIALS = [0, -0, 1, Infinity, -Infinity, Number.NaN];

function scene(rand: () => number, hostile: boolean): Scene {
  const pick = (n: number) => 1 + Math.floor(rand() * n);
  const width = rand() < 0.2 ? pick(3) : pick(140),
    height = rand() < 0.2 ? pick(3) : pick(140);
  const pages = rand() < 0.3 ? pick(3) : 0;
  const textureWidth = width + (pages ? pick(20) : 0),
    textureHeight = height + (pages ? pick(20) : 0);
  const texture = Float32Array.from({ length: textureWidth * textureHeight }, () =>
    hostile && rand() < 0.05 ? SPECIALS[Math.floor(rand() * SPECIALS.length)] : rand(),
  );
  const origins = pages
    ? Array.from(
        { length: pages },
        () =>
          [
            Math.floor(rand() * (textureWidth - width + 1)),
            Math.floor(rand() * (textureHeight - height + 1)),
          ] as [number, number],
      )
    : undefined;
  const maxLevels = rand() < 0.2 ? pick(6) : LEVEL_CAP;
  return { texture, textureWidth, width, height, maxLevels, origins };
}

function assertSamePyramid(s: Scene, rand: () => number, label: string) {
  const { words } = layout(s);
  // The same garbage on both sides: a texel one side writes and the other does not shows.
  const before = Float32Array.from({ length: words + 8 }, (_, i) => -1000 - i);
  const after = Float32Array.from(before);
  buildBefore(s, before);
  buildAfter(s, after, rand);
  assert.deepEqual(new Uint32Array(after.buffer), new Uint32Array(before.buffer), label);
}

function lcg(seed: number) {
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32) as number;
}

test('four mips per dispatch through workgroup memory leave the pyramid of the per-level build', () => {
  const rand = lcg(5);
  for (let trial = 0; trial < 300; trial++)
    assertSamePyramid(scene(rand, false), rand, `trial ${trial}`);
});

test('same pyramid, bit for bit, with NaN, ±0 and ±Inf depths', () => {
  const rand = lcg(17);
  for (let trial = 0; trial < 150; trial++)
    assertSamePyramid(scene(rand, true), rand, `trial ${trial}`);
});

test('edge sizes: one texel, one row, one column, a tile edge, 1080p, a capped mip count', () => {
  const rand = lcg(3);
  const sizes: Array<[number, number, number]> = [
    [1, 1, LEVEL_CAP],
    [1, 37, LEVEL_CAP],
    [37, 1, LEVEL_CAP],
    [16, 16, LEVEL_CAP],
    [17, 33, LEVEL_CAP],
    [128, 128, LEVEL_CAP],
    [1920, 1080, LEVEL_CAP],
    [300, 200, 2],
  ];
  for (const [width, height, maxLevels] of sizes) {
    const texture = Float32Array.from({ length: width * height }, () => rand());
    assertSamePyramid(
      { texture, textureWidth: width, width, height, maxLevels },
      rand,
      `${width}×${height}`,
    );
  }
  // 1080p: twelve mips in three dispatches, where the per-level build took twelve.
  assert.deepEqual(hizBuildPasses(hizLevelSizes(1920, 1080), LEVEL_CAP), [
    { source: 0, levels: 4 },
    { source: 4, levels: 4 },
    { source: 8, levels: 3 },
  ]);
  assert.deepEqual(hizBuildPasses([[1, 1]], LEVEL_CAP), [{ source: 0, levels: 0 }]);
  // The uniform slots the host allocates hold the deepest pyramid's passes, and no more.
  assert.equal(hizBuildPasses(hizLevelSizes(1 << 16, 1 << 16), LEVEL_CAP).length, 4);
  assert.equal(hizBuildSlots(LEVEL_CAP), 4);
  assert.equal(hizBuildSlots(8), hizBuildPasses(hizLevelSizes(128, 128), 8).length);
});

test('the shipped build is one kernel over workgroup memory, with no copy kernel left', () => {
  assert.match(HIZ_SHADER, /var<workgroup> hizTile:array<f32,64>;/);
  assert.match(HIZ_SHADER, /@compute @workgroup_size\(8, 8\)\s*fn buildHiz\(/);
  assert.doesNotMatch(HIZ_SHADER, /fn copyDepth|fn reduceHiz/);
  assert.match(HIZ_SHADER, /dst:array<vec4u,4>,\}/);
});
