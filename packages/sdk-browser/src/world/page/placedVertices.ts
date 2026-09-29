/** The vertices a seam-locked solve placed (#877): numbered past the source's, held by the coarse
 *  geometry pages naming them alone, read there by the class re-cut (`classPages.ts`). */
import type { DrawnTriangles } from '../../../../sdk-core/src/world/geometry/drawn.ts';
import type { DecodedGeometryPage } from '../../page/decode/geometryPage.ts';

/** Vertex columns as `DrawnTriangles` holds them: empty normals, or a null set, carry none. */
type Columns = Pick<DrawnTriangles, 'positions' | 'normals' | 'uvs' | 'colors'>;
/** Each column, the decoded attribute it reads and its width (`cluster/format.ts`). */
const COLUMNS = [
  ['positions', 'position', 3],
  ['normals', 'normal', 3],
  ['uvs', 'uv', 2],
  ['colors', 'color', 4],
] as const;

/** The corners of `pages` end to end, and where each page's end. */
export function joinedCorners(pages: readonly Uint32Array[]) {
  const ends = new Uint32Array(pages.length),
    indices = new Uint32Array(pages.reduce((sum, page) => sum + page.length, 0));
  pages.forEach((page, k) => {
    indices.set(page, k && ends[k - 1]);
    ends[k] = (k && ends[k - 1]) + page.length;
  });
  return { indices, ends };
}

/** `source` grown with each placed vertex `indices` names, renumbered in place after it in first
 *  use. `ends[k]` ends the corners of `pages[k]`, in its geometry page's order; `read` decodes the
 *  pages it names. A level-0 page past the source was cut from another (a stand-in's): refused. */
export async function withPlaced<T extends Columns>(
  source: T,
  { indices, ends }: { indices: Uint32Array; ends: Uint32Array },
  pages: readonly { level?: number }[],
  read: (pages: number[]) => Promise<DecodedGeometryPage[]>,
): Promise<T> {
  const count = source.positions.length / 3,
    start = (k: number) => k && ends[k - 1];
  const naming = pages
    .map((_, k) => k)
    .filter((k) => indices.subarray(start(k), ends[k]).some((v) => v >= count));
  if (naming.some((k) => !pages[k].level)) throw new Error('MATERIAL_CLASS_SOURCE_MISSING');
  if (naming.length === 0) return source;
  const decoded = await read(naming);
  const slots = new Map<number, number>();
  const placed = COLUMNS.map(() => [] as number[]);
  naming.forEach((k, n) => {
    for (let i = start(k); i < ends[k]; i++) {
      if (indices[i] < count) continue;
      if (!slots.has(indices[i])) {
        const local = decoded[n].indices[i - start(k)];
        COLUMNS.forEach(([column, name, width], c) => {
          const values = decoded[n].attributes[name];
          if (source[column]?.length)
            placed[c].push(...values.subarray(local * width, (local + 1) * width));
        });
        slots.set(indices[i], count + slots.size);
      }
      indices[i] = slots.get(indices[i])!;
    }
  });
  const grown: Columns = { ...source };
  COLUMNS.forEach(([column], c) => {
    const values = source[column];
    if (!values?.length) return;
    const out = new Float32Array(values.length + placed[c].length);
    out.set(values);
    grown[column] = (out.set(placed[c], values.length), out);
  });
  return grown as T;
}
