// Batch F oracles, WebGPU engine-prepare side: `webgpuPagesPrepare.ts:23-44`,
// `webgpuPagesSetup.ts:94-105` and `webgpuPagesPrepareTextures.ts:37-42` from before batch F.
import type { HostAttributes } from '../../hostResources.ts';
import { OPEN_CONE, triangleCone } from '../../pageCone.ts';
import { visMaterial } from '../../visibilityBuffer.ts';
import type { PageRec } from '../../pageSelectionTypes.ts';

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

/** `prepareCones` before batch F: per-vertex accessors and the material read twice. */
export function referencePrepareCones(rt: { setup: { allPages: PageRec[] } }) {
  const xyzCache = new WeakMap<HostAttributes, Float32Array>();
  for (const rec of rt.setup.allPages) {
    const array = rec.array,
      attr = rec.attributes.position;
    if (!array || !attr) continue;
    let xyz = xyzCache.get(rec.attributes);
    if (!xyz) {
      xyz = new Float32Array(attr.count * 3);
      for (let i = 0; i < attr.count; i++) {
        xyz[i * 3] = attr.getX(i);
        xyz[i * 3 + 1] = attr.getY(i);
        xyz[i * 3 + 2] = attr.getZ(i);
      }
      xyzCache.set(rec.attributes, xyz);
    }
    rec.cone =
      visMaterial(rec.material).doubleSided || visMaterial(rec.material).backSide
        ? OPEN_CONE
        : triangleCone(xyz, array);
  }
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
