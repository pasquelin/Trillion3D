import * as THREE from 'three';
import {
  FLAG_BACK,
  FLAG_DOUBLE,
  FLAG_HAS_NORMAL,
  FLAG_HAS_TANGENT,
  FLAG_LIT,
  FLAG_PAGED,
  FLAG_TRANSMISSIVE,
  FLAG_WRAP_S_REPEAT,
  FLAG_WRAP_T_REPEAT,
  isTransmissive,
  visMaterial,
} from './visibilityBuffer.ts';
import { ensureWebgpuPositionBuffer } from './webgpuPositions.ts';
import {
  ensureBlendIndexBuffer,
  ensureBlendNormalBuffer,
  ensureBlendUvBuffer,
} from './webgpuBlendBuffers.ts';
import type { createWebgpuBlendState } from './webgpuBlendState.ts';
import type { WebgpuGpuState } from './webgpuPagesStateGpu.ts';
type BlendState = ReturnType<typeof createWebgpuBlendState>;

/** Creates forward transparent GPU items while preserving source mesh order and materials. */
export function prepareWebgpuBlend(
  device: GPUDevice,
  blendCopies: THREE.Mesh[],
  gpu: WebgpuGpuState,
  blendState: BlendState,
  scene: THREE.Scene,
) {
  let transmissive = 0;
  for (const copy of blendCopies) {
    // Une surface transmissive traverse la même préparation que les autres mélanges : elle n'en
    // diffère qu'au dessin, où elle relit le fond figé au lieu de le mélanger par alpha.
    const transmits = isTransmissive(copy.material);
    if (transmits) transmissive++;
    const mat = visMaterial(copy.material);
    const attr = copy.geometry.attributes.position,
      idx = copy.geometry.getIndex();
    if (!attr || !idx) continue;
    const position = ensureWebgpuPositionBuffer(
      device,
      copy.geometry.attributes,
      gpu.positionBuffers,
      gpu,
    )!;
    const paged = !!copy.userData.pagedBlend;
    // A paged primitive reads its indices from the page cache, cluster by cluster: it owns none.
    // Les trois autres tampons appartiennent à la géométrie, pas au placement : neuf instances d'un
    // objet les écrivent une fois. Les octets sont les mêmes, l'ordre des items aussi.
    const index = paged ? undefined : ensureBlendIndexBuffer(device, idx, gpu);
    const uv = ensureBlendUvBuffer(device, copy.geometry.attributes, gpu);
    const tangentAttr = copy.geometry.attributes.tangent;
    const normal = ensureBlendNormalBuffer(device, copy.geometry.attributes, gpu);
    const opacity = Array.isArray(copy.material)
      ? ((copy.material[0] as THREE.MeshBasicMaterial).opacity ?? 1)
      : ((copy.material as THREE.MeshBasicMaterial).opacity ?? 1);
    let flags = 0;
    if (mat.lit) flags |= FLAG_LIT;
    if (mat.doubleSided) flags |= FLAG_DOUBLE;
    if (normal) flags |= FLAG_HAS_NORMAL;
    if (tangentAttr) flags |= FLAG_HAS_TANGENT;
    if (mat.backSide) flags |= FLAG_BACK;
    if (paged) flags |= FLAG_PAGED;
    if (transmits) flags |= FLAG_TRANSMISSIVE;
    if (mat.map && mat.map.wrapS !== THREE.ClampToEdgeWrapping) flags |= FLAG_WRAP_S_REPEAT;
    if (mat.map && mat.map.wrapT !== THREE.ClampToEdgeWrapping) flags |= FLAG_WRAP_T_REPEAT;
    // Static source transforms are baked for this backend. World AABBs remain
    // conservative under rotation, mirroring, nonuniform scale and shear.
    let bounds: THREE.Box3 | undefined;
    if (copy.frustumCulled) {
      if (!copy.geometry.boundingBox) copy.geometry.computeBoundingBox();
      const box = copy.geometry.boundingBox?.clone().applyMatrix4(copy.matrix);
      if (
        box &&
        !box.isEmpty() &&
        [...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite)
      )
        bounds = box;
    }
    const item = {
      transmissive: transmits,
      position,
      index,
      uv,
      normal,
      material: copy.material,
      count: paged ? 0 : idx.count,
      matrix: copy.matrix,
      sourceMesh: copy.userData.sourceMesh as THREE.Mesh | undefined,
      sourceGeometry: copy.geometry,
      bounds,
      rgba: [mat.baseColor[0], mat.baseColor[1], mat.baseColor[2], opacity] as [
        number,
        number,
        number,
        number,
      ],
      map: mat.map,
      flags,
      paged,
    };
    blendState.blendGpu.push(item);
    if (paged && item.sourceMesh) blendState.pagedBlendGpu.set(item.sourceMesh, item);
    scene.remove(copy);
  }
  return transmissive;
}
