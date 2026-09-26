// #748: the card's WebGPU chains pick `t` and scale as the compiler does. The shipped WGSL is run
// here, its types stripped, on the table the compiler's test reads too
// (`texture_preview/tests/coverage_alpha.rs`): one expected answer for every builder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COVERAGE_PICK_WGSL, COVERAGE_SCALE_WGSL } from './coverageRule.ts';
import { CoverageReaders, cutoffByte } from './coverage.ts';
import type { PageSurface } from '../page/surface.ts';
import type { Texture } from '../../../sdk-core/src/index.ts';

const table = JSON.parse(
  readFileSync(
    new URL('../../../../tests/fixtures/formats/previews/coverage-alpha.json', import.meta.url),
    'utf8',
  ),
) as { cases: string[] };

/** A vector as WGSL builds one, flattened, each word an unsigned 32-bit integer. */
const v = (...parts: Array<number | Record<string, number>>) => {
  const words = parts.flatMap((part) =>
    typeof part === 'number' ? [part >>> 0] : Object.values(part),
  );
  return Object.fromEntries(words.map((word, i) => ['xyzw'[i], word]));
};
type Rule = {
  scaled(a: number, c: number, t: number): number;
  wide(a: number, b: number): { x: number; y: number };
  pick(c: number, covered: number, texels: ReturnType<typeof v>): number;
};

/** The rule text as JavaScript: functions and declarations stripped of their types, integer
 *  conversions truncating, shifts unsigned; `binOf` reads the histogram given. */
function evaluate(source: string, histogram: () => number[]): Rule {
  const params = (list: string) => list.split(',').map((param) => param.split(':')[0]);
  const js = source
    .replace(/fn (\w+)\(([^)]*)\)->\w+\{/g, (_, name, list) => `function ${name}(${params(list)}){`)
    .replace(/\b(?:let|var) (\w+)=/g, 'let $1=')
    .replace(/\b(?:vec2u|vec4u)\(/g, 'v(')
    .replace(/\bu32\(/g, 'Math.trunc(')
    .replace(/\b(min|max|round)\(/g, 'Math.$1(')
    .replace(/\b(0x[\da-f]+|\d+)u\b/g, '$1')
    .replace(/>>/g, '>>>');
  const select = (no: unknown, yes: unknown, when: boolean) => (when ? yes : no);
  const binOf = (t: number) => histogram()[t];
  return new Function('v', 'select', 'binOf', `${js};return {scaled,wide,pick};`)(v, select, binOf);
}

test("the WGSL pick of t and scale are the compiler's, on its table", () => {
  let histogram: number[] = [];
  const rule = evaluate(COVERAGE_SCALE_WGSL + COVERAGE_PICK_WGSL, () => histogram);
  for (const row of table.cases) {
    const [[cutoff], level0, level, [t], scaled] = row
      .split('|')
      .map((part) => part.trim().split(' ').map(Number));
    histogram = Array.from({ length: 256 }, (_, byte) => level.filter((a) => a === byte).length);
    const covered = level0.filter((a) => a >= cutoff).length;
    const picked = rule.pick(cutoff, covered, v(level0.length, level.length));
    assert.equal(picked, t, row);
    assert.deepEqual(
      level.map((a) => rule.scaled(a, cutoff, t)),
      scaled,
      row,
    );
  }
  // Products past 32 bits: a 16384² level 0 against its level 1.
  for (const [a, b] of [
    [16384 ** 2, 8192 ** 2 - 3],
    [0xffffffff, 0xffffffff],
    [65536, 65535],
  ]) {
    const { x, y } = rule.wide(a, b);
    assert.equal((BigInt(x) << 32n) | BigInt(y), BigInt(a) * BigInt(b), `${a} × ${b}`);
  }
});

// #44's `cutoff_byte`, the product the engine cuts, and a texture cut at the lowest cutoff of its
// masked readers, not at all once one of them blends or its chain does not weigh by alpha.
test('a chain is cut at its readers’ lowest cutoff byte, 0 once one blends', () => {
  assert.deepEqual(
    [0.5, 0.25, 1 / 255, 1].map((cutoff) => cutoffByte(cutoff, 1)),
    [128, 64, 1, 255],
  );
  // 0.66 / 0.9 × 255 is 187 on the dot, which the product keeps and the quotient rounds to 188.
  assert.deepEqual(
    [cutoffByte(0.66, 0.9), cutoffByte(0.5, 0), cutoffByte(0.5, 0.25)],
    [187, 255, 255],
  );
  const map = { premultiplyAlpha: false } as Texture,
    readers = new CoverageReaders();
  const surface = (alphaTest: number, transparent = false, opacity = 1) =>
    readers.read({
      map,
      alphaTest,
      transparent,
      opacity,
      blending: 'normal',
      transmission: 0,
    } as PageSurface);
  surface(0.5);
  surface(0.25, false, 0.5);
  assert.equal(readers.cutoff(map), 128, '0.25 under a factor of 0.5 cuts at 0.5');
  surface(0.25);
  assert.equal(readers.cutoff(map), 64);
  surface(0, true);
  assert.equal(readers.cutoff(map), 0, 'a blended reader: the median alone');
  surface(0);
  assert.equal(readers.cutoff(map), 0, 'an opaque reader: the plain chain');
});
