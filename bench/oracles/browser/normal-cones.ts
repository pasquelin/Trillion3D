// Batch F oracles, WebGPU engine-prepare side: `packages/sdk-browser/src/webgpu/pages/prepare/prepare.ts:23-44`,
// `packages/sdk-browser/src/webgpu/pages/prepare/setup.ts:94-105` and `packages/sdk-browser/src/webgpu/pages/prepare/textures.ts:37-42` from before batch F.
import type { PageRec } from '../../../packages/sdk-browser/src/page/selection/types.ts';

interface ConesRoot {
  cones?: boolean;
  pages: PageRec[];
}

/**
 * The input of `prepareCones`, written here once for the bench as for the test.
 *
 * The function walks pages **by root**, because posing a cone is declaring it;
 * the oracle walks the catalogue. Both fields state the same list in the same order,
 * and that is what this function guarantees. A second place that built this input by
 * hand would have no type to reread it — that is how the bench broke when the function
 * moved from the catalogue to the roots.
 */
export function entreeCones(pages: PageRec[], roots: ConesRoot[] = [{ cones: false, pages }]) {
  return { setup: { allPages: pages, roots } };
}

/** Source-byte table before batch F: one `flatMap` of a pair per page. */
export function referenceIndexSourceBytes(allPages: PageRec[]) {
  return new Map(
    allPages.flatMap((page) =>
      page.array
        ? [
            [
              page.url,
              new Uint8Array(page.array.buffer, page.array.byteOffset, page.array.byteLength),
            ],
          ]
        : [],
    ),
  );
}

/** Diagnostic counters before batch F: a full `map` and two copies of the table. */
export function referenceCompteMateriauxEtTangentes(
  allPages: readonly PageRec[],
  geometryBlocks: ReadonlyMap<unknown, { hasTangent: boolean }>,
) {
  return {
    materials: new Set(allPages.map((page) => page.material)).size,
    geometryWithTangents: [...geometryBlocks.values()].filter((block) => block.hasTangent).length,
    geometryWithoutTangents: [...geometryBlocks.values()].filter((block) => !block.hasTangent)
      .length,
  };
}
