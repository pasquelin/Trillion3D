// #926: the water word no longer takes a 4 B/px `r32uint` target of its own: the surface stage
// writes its four bytes into the display colour (`rgba8unorm`) and the composite packs them back.
// Every rank and opacity must read back as the word the stage packed — what the `r32uint` target
// returned — through the GPU's float-to-unorm8 store and its unorm8-to-float load.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WATER_MAX_ITEMS,
  WATER_RANK_SHIFT,
  WATER_SURFACE_WGSL,
  WATER_UNPACK_WGSL,
} from './surfaceWgsl.ts';
import { WATER_COMPOSITE_SHADER } from './compositeWgsl.ts';
import { shaderFunctions } from '../../texture/shaderRule.fixture.ts';

const f32 = Math.fround;
/** WGSL `unpack4x8unorm`: each byte over 255, low byte first. */
const unpack4x8unorm = (word: number) =>
  [0, 8, 16, 24].map((shift) => f32(((word >>> shift) & 255) / 255));
/** What an `rgba8unorm` target keeps of a channel written, then returns when loaded. */
const stored = (channel: number) => f32(Math.round(Math.min(1, Math.max(0, channel)) * 255) / 255);
/** WGSL `pack4x8unorm`: `u32(0.5 + 255 × clamp(e, 0, 1))` per channel, low byte first. */
const pack4x8unorm = (channels: number[]) =>
  channels.reduce(
    (word, e, i) =>
      (word | (Math.trunc(f32(0.5 + f32(255 * Math.min(1, Math.max(0, e))))) << (8 * i))) >>> 0,
    0,
  );

type Unpack = { waterWordAt: (coord: unknown) => number };

test('the surface stage writes the word as four unorm bytes into the display colour', () => {
  assert.match(WATER_SURFACE_WGSL, /@location\(3\) word:vec4f/);
  const packed = new RegExp(
    `unpack4x8unorm\\(\\(in\\.water&${WATER_MAX_ITEMS}u\\)\\|\\(opacity<<${WATER_RANK_SHIFT}u\\)\\)`,
  );
  assert.match(WATER_SURFACE_WGSL, packed);
  assert.match(WATER_COMPOSITE_SHADER, /@binding\(3\) var waterWord:texture_2d<f32>;/);
  assert.match(WATER_COMPOSITE_SHADER, /let packed=waterWordAt\(coord\);/);
});

test('every rank and opacity reads back as the word the stage packed', () => {
  let texel: number[] = [];
  const read = shaderFunctions<Unpack>(WATER_UNPACK_WGSL, ['waterWordAt'], {
    waterWord: {},
    textureLoad: () => texel,
    pack4x8unorm,
  });
  const words = [0, 1, WATER_MAX_ITEMS, 1 | (65535 << WATER_RANK_SHIFT), 0xffffffff, 0x80808080];
  let seed = 926;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0), seed);
  for (let i = 0; i < 20000; i++) words.push(random());
  for (let rank = 1; rank <= WATER_MAX_ITEMS; rank += 257)
    for (const opacity of [0, 1, 127, 128, 255, 256, 32767, 65534, 65535])
      words.push((rank | (opacity << WATER_RANK_SHIFT)) >>> 0);
  // A backend may truncate rather than round the float-to-unorm8 store: every byte survives both.
  for (let k = 0; k < 256; k++) assert.equal(Math.trunc(f32(f32(k / 255) * 255)), k, `byte ${k}`);
  for (const word of words) {
    texel = unpack4x8unorm(word).map(stored);
    // `waterRank` and `waterOpacity` read the same word the `r32uint` target returned.
    assert.equal(read.waterWordAt(0), word >>> 0, `word ${word}`);
  }
});
