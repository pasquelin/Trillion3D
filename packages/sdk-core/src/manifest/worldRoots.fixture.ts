import type { WorldRoots } from './worldRoots.ts';

/** One super-root page as the cook writes it: a triangle of three vertices, `x` its offset. */
export function worldPage(x: number) {
  const bytes = new Uint8Array(8 + 3 * 12 + 8),
    view = new DataView(bytes.buffer);
  view.setUint32(0, 3, true);
  view.setUint32(4, 1, true);
  [x, 0, 0, x + 1, 0, 0, x, 1, 0].forEach((value, at) => view.setFloat32(8 + at * 4, value, true));
  [0, 1, 2].forEach((index, at) => view.setUint16(44 + at * 2, index, true));
  return bytes;
}

/**
 * A world of three cells over four bundles of one page each: the top, bundle 0, pinned; bundles 1
 * and 2 the super-roots of cells 0 and 1; bundle 3, which cells 0 and 1 both need. Cell 2's
 * objects reach the top alone. `sha256` names each bundle's digest, `table.payload` the binary.
 */
export function worldRootsFixture(sha256: (bytes: Uint8Array) => string = () => '0') {
  const pages = [0, 1, 2, 3].map(worldPage);
  const bin = new Uint8Array(pages.reduce((sum, page) => sum + page.byteLength, 0));
  let offset = 0;
  const bundles = pages.map((page, at) => {
    bin.set(page, offset);
    const bundle = {
      offset,
      bytes: page.byteLength,
      sha256: sha256(page),
      count: 1,
      dependencies: at ? [0] : [],
    };
    offset += page.byteLength;
    return bundle;
  });
  const object = (dependencies: number[]) => ({ node: 0, primitive: 0, roots: [0], dependencies });
  const table: WorldRoots = {
    version: 1,
    budgetBytes: 4 << 20,
    pinned: 1,
    pinnedTopBytes: bundles[0].bytes,
    payload: { url: 'world-roots.bin', sha256: sha256(bin), bytes: bin.byteLength },
    bundles,
    pages: bundles.map((_, bundle) => ({ bundle, offset: 0, level: 3 - bundle, lodError: 1 })),
    cells: [
      { objects: [object([0, 1, 3])] },
      { objects: [object([0, 2, 3]), object([0])] },
      { objects: [object([0])] },
    ],
  };
  return { table, bin };
}
