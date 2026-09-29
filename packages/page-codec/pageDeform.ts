/**
 * The reference encoder's deformation streams (#357): each vertex's four joints on the page's
 * own base and width, three of its weights on 255 steps summing with the fourth to 255, and each
 * morph target's position displacement on the page grid and normal displacement on 2^-10 — the
 * format of `page-codec-wasm/src/deform.rs`, written again here without sharing a line.
 */
import { bitsFor, quantize, type Packer, type QuantizedGrid } from './pageGrids.ts';
import type { PageAttribute, PageAttributes } from './pageAttributes.ts';

/** A morph target handed to the encoder: its displacements per source vertex. */
export interface PageTarget {
  POSITION: PageAttribute;
  NORMAL?: PageAttribute;
}

const NORMAL_EXPONENT = -10;

/** Four weights on 255 steps summing to 255: floors, then the steps left to the largest
 *  remainders, the earlier first on a tie; nothing to share leans on the first joint. */
export function weightSteps(weights: readonly number[]) {
  const positive = weights.map((w) => Math.max(0, Math.fround(w))),
    sum = Math.fround(positive.reduce((a, b) => Math.fround(a + b), 0));
  if (!(sum > 0)) return [255, 0, 0, 0];
  const scaled = positive.map((w) => Math.fround(Math.fround(w / sum) * 255)),
    steps = scaled.map(Math.floor),
    order = [0, 1, 2, 3].sort((a, b) => scaled[b] - steps[b] - (scaled[a] - steps[a]) || a - b);
  let left =
    255 -
    Math.min(
      255,
      steps.reduce((a, b) => a + b, 0),
    );
  for (const j of order) if (left-- > 0) steps[j]++;
  return steps;
}

/** Each vertex's deformation fields in `original` order, and the page's records. */
export function deformCells(
  { JOINTS_0: joints, WEIGHTS_0: weights }: PageAttributes,
  targets: readonly PageTarget[],
  original: readonly number[],
  positionExponent: number,
) {
  const fields = original.map(() => [] as number[]);
  let skin: { base: number; bits: number } | null = null;
  if (joints && weights) {
    const all = original.flatMap((v) =>
      Array.from({ length: 4 }, (_, j) => joints.array[v * 4 + j]),
    );
    const base = Math.min(...all);
    skin = { base, bits: bitsFor(Math.max(...all) - base) };
    original.forEach((v, i) => {
      const own = Array.from({ length: 4 }, (_, j) => weights.array[v * 4 + j]);
      fields[i].push(
        ...all.slice(i * 4, i * 4 + 4).map((j) => j - base),
        ...weightSteps(own).slice(0, 3),
      );
    });
  }
  const morphs: { position: QuantizedGrid; normal: QuantizedGrid; start: number }[] = [];
  for (const target of targets) {
    const gather = (attribute: PageAttribute | undefined) =>
      original.flatMap((v) => [0, 1, 2].map((c) => (attribute ? attribute.array[v * 3 + c] : 0)));
    const position = quantize(gather(target.POSITION), 3, positionExponent),
      normal = quantize(gather(target.NORMAL), 3, NORMAL_EXPONENT);
    original.forEach((_, i) =>
      fields[i].push(
        ...position.cells.slice(i * 3, i * 3 + 3),
        ...normal.cells.slice(i * 3, i * 3 + 3),
      ),
    );
    morphs.push({ position, normal, start: 0 });
  }
  return { fields, skin, morphs };
}

/** Writes the fields of the kept vertices, skin then targets, noting where each target starts. */
export function packDeformation(
  pack: Packer,
  deform: ReturnType<typeof deformCells>,
  kept: readonly number[][],
) {
  let column = 0;
  const stream = (bits: number) => {
    const at = column++;
    pack.stream(
      kept.map((row) => row[at]),
      bits,
    );
  };
  if (deform.skin) {
    for (let j = 0; j < 4; j++) stream(deform.skin.bits);
    for (let j = 0; j < 3; j++) stream(8);
  }
  for (const morph of deform.morphs) {
    morph.start = pack.words.length;
    for (const grid of [morph.position, morph.normal]) for (const bits of grid.bits) stream(bits);
  }
}

/** Word 23 — the joint width, the target count and the smallest joint — and each target's nine
 *  words. */
export function deformHeader(
  head: DataView,
  deform: ReturnType<typeof deformCells>,
  record: (word: number, grid: QuantizedGrid) => void,
) {
  const skin = deform.skin ?? { bits: 0, base: 0 };
  head.setUint32(92, (skin.bits | (deform.morphs.length << 6) | (skin.base << 14)) >>> 0, true);
  deform.morphs.forEach(({ start, position, normal }, t) => {
    const at = 24 + t * 9;
    head.setUint32(at * 4, start, true);
    record(at + 1, position);
    record(at + 5, normal);
  });
}
