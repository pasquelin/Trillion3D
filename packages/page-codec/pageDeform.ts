/**
 * The reference encoder's deformation streams (#357): each vertex's joints on the page's
 * own base and width, every weight as float32 bits, and each
 * morph target's position and normal displacement as exact float32 bits — the
 * format of `page-codec-wasm/src/deform.rs`, written again here without sharing a line.
 */
import { bitsFor, type Packer, type QuantizedGrid } from './pageGrids.ts';
import type { PageAttribute, PageAttributes } from './pageAttributes.ts';

/** Header words of one morph target: its first stream, then its position and normal records. */
export const MORPH_WORDS = 9;

/** A morph target handed to the encoder: its displacements per source vertex. */
export interface PageTarget {
  POSITION: PageAttribute;
  NORMAL?: PageAttribute;
}

/** Each vertex's deformation fields in `original` order, and the page's records. */
export function deformCells(
  attributes: PageAttributes,
  targets: readonly PageTarget[],
  original: readonly number[],
) {
  const fields = original.map(() => [] as number[]);
  const ranks = [
    ...new Set(
      Object.keys(attributes)
        .filter((key) => /^(JOINTS|WEIGHTS)_/.test(key))
        .map((key) => Number(key.split('_')[1])),
    ),
  ].sort((a, b) => a - b);
  const sets = ranks.map((rank) => {
    const joints = attributes[`JOINTS_${rank}`],
      weights = attributes[`WEIGHTS_${rank}`];
    if (!joints || !weights || joints.itemSize !== weights.itemSize)
      throw new Error('PAGE_SKIN_ATTRIBUTES');
    return { joints, weights };
  });
  const width = sets.reduce((sum, { joints }) => sum + joints.itemSize, 0);
  if (width > 65536) throw new Error('PAGE_SKIN_ATTRIBUTES');
  let skin: { base: number; bits: number; influences: number } | null = null;
  if (width) {
    const all = original.map((v) =>
      sets.flatMap(({ joints }) =>
        Array.from({ length: joints.itemSize }, (_, j) => joints.array[v * joints.itemSize + j]),
      ),
    );
    let base = 65535,
      top = 0;
    for (const row of all)
      for (const joint of row) {
        if (!Number.isInteger(joint) || joint < 0 || joint > 65535)
          throw new Error('PAGE_SKIN_ATTRIBUTES');
        base = Math.min(base, joint);
        top = Math.max(top, joint);
      }
    const bits = bitsFor(top - base);
    // The reader bounds every field the width allows, `base + 2^bits - 1`, to 65,535: a base that
    // high comes down, the width unchanged since `top` stays within it.
    base = Math.min(base, 65536 - 2 ** bits);
    skin = { base, bits, influences: width };
    original.forEach((v, i) => {
      const own = sets.flatMap(({ weights }) =>
        Array.from({ length: weights.itemSize }, (_, j) => weights.array[v * weights.itemSize + j]),
      );
      if (own.some((w) => !Number.isFinite(w) || w < 0)) throw new Error('PAGE_SKIN_ATTRIBUTES');
      fields[i].push(
        ...all[i].map((j) => j - base),
        ...new Uint32Array(new Float32Array(own).buffer),
      );
    });
  }
  const morphs: { position: QuantizedGrid; normal: QuantizedGrid; start: number }[] = [];
  const gather = (attribute: PageAttribute | undefined) =>
    original.flatMap((v) => [0, 1, 2].map((c) => (attribute ? attribute.array[v * 3 + c] : 0)));
  const raw = (values: number[]): QuantizedGrid => {
    if (values.some((v) => !Number.isFinite(Math.fround(v))))
      throw new Error('PAGE_ATTRIBUTE_NONFINITE');
    return {
      min: [0, 0, 0],
      exponent: 0,
      bits: [32, 32, 32],
      cells: Array.from(new Uint32Array(new Float32Array(values).buffer)),
    };
  };
  for (const target of targets) {
    const position = raw(gather(target.POSITION)),
      normal = raw(gather(target.NORMAL));
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
    for (let j = 0; j < deform.skin.influences; j++) stream(deform.skin.bits);
    for (let j = 0; j < deform.skin.influences; j++) stream(32);
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
  headerWords: number,
) {
  const skin = deform.skin ?? { bits: 0, base: 0, influences: 0 };
  head.setUint32(92, (skin.bits | (deform.morphs.length << 6) | (skin.base << 14)) >>> 0, true);
  head.setUint32(96, skin.influences, true);
  deform.morphs.forEach(({ start, position, normal }, t) => {
    const at = headerWords + t * MORPH_WORDS;
    head.setUint32(at * 4, start, true);
    record(at + 1, position);
    record(at + 5, normal);
  });
}
