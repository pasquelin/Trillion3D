/**
 * The vertices a seam-locked solve placed (#877). The compiler numbers them from the source's
 * vertex count on: a coarse page's corners may name them, and only its geometry page holds them,
 * `source.bin` keeping the source alone. What reads a compiled primitive's clusters over its source
 * vertices — the class re-cut (`classPages.ts`) — reads those from the decoded pages naming them.
 */
import type { DecodedGeometryPage } from '../../page/decode/geometryPage.ts';

/** Vertex columns as `DrawnTriangles` holds them: empty normals, or a null set, carry none. */
export type VertexColumns = {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array | null;
  colors: Float32Array | null;
};

/** Each column, the decoded page attribute it reads and its width (`cluster/format.ts`). */
const COLUMNS = [
  ['positions', 'position', 3],
  ['normals', 'normal', 3],
  ['uvs', 'uv', 2],
  ['colors', 'color', 4],
] as const;

/** The corners of `pages`, one after the other, and where each page's end. */
export function joinedCorners(pages: readonly Uint32Array[]) {
  const ends = new Uint32Array(pages.length),
    indices = new Uint32Array(pages.reduce((sum, page) => sum + page.length, 0));
  let offset = 0;
  pages.forEach((page, k) => {
    indices.set(page, offset);
    ends[k] = offset += page.length;
  });
  return { indices, ends };
}

/**
 * `source`'s columns grown with every placed vertex `indices` names, which are renumbered in place
 * after the source's vertices, in first-use order. `ends[k]` ends page `k`'s corners, listed as
 * its geometry page lists them; `coarse(k)` tells a coarse level's page, the only kind a solve
 * writes; `read` decodes the geometry pages of the page numbers it is given. A level-0 page naming
 * a vertex past the source was cut from another source (a stand-in's): refused.
 */
export async function withPlaced<T extends VertexColumns>(
  source: T,
  indices: Uint32Array,
  ends: Uint32Array,
  coarse: (page: number) => boolean,
  read: (pages: number[]) => Promise<DecodedGeometryPage[]>,
): Promise<T> {
  const count = source.positions.length / 3;
  const starts = [0, ...ends.subarray(0, ends.length - 1)];
  const naming = [...ends.keys()].filter((k) =>
    indices.subarray(starts[k], ends[k]).some((v) => v >= count),
  );
  if (naming.some((k) => !coarse(k))) throw new Error('MATERIAL_CLASS_SOURCE_MISSING');
  if (naming.length === 0) return source;
  const decoded = await read(naming);
  const slots = new Map<number, number>();
  const placed = COLUMNS.map(() => [] as number[]);
  naming.forEach((k, n) => {
    for (let i = starts[k]; i < ends[k]; i++) {
      const v = indices[i];
      if (v < count) continue;
      if (!slots.has(v)) {
        const local = decoded[n].indices[i - starts[k]];
        COLUMNS.forEach(([column, name, width], c) => {
          const values = decoded[n].attributes[name];
          if (source[column]?.length)
            placed[c].push(...values.subarray(local * width, (local + 1) * width));
        });
        slots.set(v, count + slots.size);
      }
      indices[i] = slots.get(v)!;
    }
  });
  const grown: VertexColumns = { ...source };
  COLUMNS.forEach(([column], c) => {
    const values = source[column];
    if (!values?.length) return;
    const out = new Float32Array(values.length + placed[c].length);
    out.set(values);
    out.set(placed[c], values.length);
    grown[column] = out;
  });
  return grown as T;
}
