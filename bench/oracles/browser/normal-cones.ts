// Batch F oracles, WebGPU engine-prepare side: the source-byte table and the texture diagnostic
// counters (`packages/sdk-browser/src/webgpu/pages/io/catalogue.ts`) as they were before batch F.
import type { PageRec } from '../../../packages/sdk-browser/src/page/selection/types.ts';

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
