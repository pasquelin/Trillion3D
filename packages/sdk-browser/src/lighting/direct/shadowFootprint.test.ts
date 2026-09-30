// #1250: the shipped `shadowPageWord`, run from its WGSL through `shaderRun`: a texel outside the
// footprint its page was drawn for reads as a page not drawn — asked for, never read —, one inside
// reads the page as before, and says it missed (#1211); with every page drawn full, the read and its
// requests are develop's to the bit; and every pass that lights a surface reads the page table
// through it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PAGE_VALID } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { PAGE_MODEL_FUNCTIONS } from '../../../../sdk-core/src/scene/light-shadow/pageModelWgsl.ts';
import { seeded } from '../../../../../site/examples/kit/random.ts';
import { functionsOf } from '../../texture/shaderRule.fixture.ts';
import { shaderRun } from '../../texture/shaderRun.fixture.ts';
import { contractLightingShader } from '../deferred/shaders.ts';
import { reflectionSource } from '../../reflections/screenWgsl.ts';
import { CONSTANTS, SHADOW_WGSL } from './sunRangeRead.fixture.ts';
import { DRAWN_BITS, footprintReads, type PageMap } from './shadowFootprint.fixture.ts';
import { blendShader } from '../../webgpu/blend/shader.ts';
import { waterCompositeShader } from '../../webgpu/water/compositeWgsl.ts';

const BLEND_SHADER = blendShader();
const WATER_COMPOSITE_SHADER = waterCompositeShader();

type Read = (map: PageMap, p: number[], t: number[]) => number;
/** The page table read, the pages asked for and those missed: swapped per read, the text
 *  compiled once. */
const live = { table: new Uint32Array(0), asked: [] as number[], missed: [] as number[] };
const { shadowPageWord } = shaderRun<{ shadowPageWord: Read }>(
  SHADOW_WGSL,
  ['shadowPageWord', 'shadowPageEntry', 'shadowFootprintCovers', ...PAGE_MODEL_FUNCTIONS],
  {
    ...CONSTANTS,
    shadows: live,
    requestShadowPage: (e: number) => live.asked.push(e),
    requestShadowMiss: (e: number) => live.missed.push(e),
  },
);
/** The shipped read of page `p` of `map` at texel `t` over `table`: its word, its requests, and
 *  the pages it found drawn for a footprint that misses `t`. */
function read(table: Uint32Array, map: PageMap, p: number[], t: number[]) {
  Object.assign(live, { table, asked: [], missed: [] });
  return { word: shadowPageWord(map, p, t), asked: live.asked, missed: live.missed };
}

test('a texel outside its page’s footprint reads as not drawn, asks for it and says it missed', () => {
  const { words, reads } = footprintReads();
  assert.ok(reads.some((r) => r.word === 0) && reads.some((r) => r.word !== 0));
  // Every page of `footprintReads` is drawn: a read that takes nothing missed its footprint.
  for (const { map, p, t, entry, word } of reads)
    assert.deepEqual(
      read(words, map, p, t),
      { word, asked: [entry], missed: word ? [] : [entry] },
      `${map.ring} ${t}`,
    );
});

/** Develop's read, restated: the entry, asked for; its word when valid; no miss. A ring asks for
 *  nothing outside its window. */
function developRead(table: Uint32Array, map: PageMap, [x, y]: number[]) {
  const ring = (v: number) => ((v % map.pages) + map.pages) % map.pages;
  if (map.ring && (Math.min(x, y) < 0 || Math.max(x, y) >= map.pages))
    return { word: 0, asked: [], missed: [] };
  const q = [x, y].map((v) => Math.min(Math.max(v, 0), map.pages - 1));
  const entry = map.ring
    ? map.base + ring(y + map.oy) * map.pages + ring(x + map.ox)
    : map.base + q[1] * map.pages + q[0];
  return { word: table[entry] & PAGE_VALID ? table[entry] : 0, asked: [entry], missed: [] };
}

test('with every page drawn full, the read and its requests are develop’s, bit for bit', () => {
  const next = seeded(1250),
    int = (n: number) => Math.floor(next() * n);
  for (let k = 0; k < 4000; k++) {
    const pages = [1, 4, 32, 64][int(4)],
      map = { base: int(1 << 16), ring: int(2), pages, ox: int(200) - 100, oy: int(200) - 100 };
    const table = new Uint32Array(map.base + pages * pages);
    for (let i = map.base; i < table.length; i++) table[i] = (next() * 2 ** 32) & DRAWN_BITS;
    const p = [int(pages + 4) - 2, int(pages + 4) - 2],
      t = p.map((v) => (v + next() * 3 - 1) * CONSTANTS.SHADOW_PAGE);
    assert.deepEqual(read(table, map, p, t), developRead(table, map, p), `read ${k}`);
  }
});

test('every pass that lights a surface reads the page table through the footprint check', () => {
  const opaque = contractLightingShader(true, false);
  for (const [name, shader] of Object.entries({
    opaque,
    narrow: contractLightingShader(false, true),
    reflections: reflectionSource(opaque),
    blend: BLEND_SHADER,
    water: WATER_COMPOSITE_SHADER,
  })) {
    assert.equal(shader.split('shadows.table[').length, 2, `${name}: one read of the table`);
    assert.match(functionsOf(shader, ['shadowPageWord']), /shadows\.table\[[^]*Covers\(word,/);
  }
});
