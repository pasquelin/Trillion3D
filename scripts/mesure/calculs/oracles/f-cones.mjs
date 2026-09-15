// Oracles du lot F, côté préparation d'un moteur WebGPU : `webgpuPagesPrepare.ts:23-44`,
// `webgpuPagesSetup.ts:94-105` et `webgpuPagesPrepareTextures.ts:37-42` d'avant le lot F.
import { OPEN_CONE, triangleCone } from '../../../../packages/sdk-browser/pageCone.ts';
import { visMaterial } from '../../../../packages/sdk-browser/visibilityBuffer.ts';

/** `prepareCones` avant le lot F : accesseurs sommet par sommet et matériau lu deux fois. */
export function referencePrepareCones(rt) {
  const xyzCache = new WeakMap();
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

/** La table des octets source avant le lot F : un `flatMap` d'un couple par page. */
export function referenceIndexSourceBytes(allPages) {
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

/** Les compteurs du diagnostic avant le lot F : un `map` complet et deux copies de la table. */
export function referenceCompteMateriauxEtTangentes(allPages, geometryBlocks) {
  return {
    materials: new Set(allPages.map((page) => page.material)).size,
    geometryWithTangents: [...geometryBlocks.values()].filter((block) => block.hasTangent).length,
    geometryWithoutTangents: [...geometryBlocks.values()].filter((block) => !block.hasTangent)
      .length,
  };
}
