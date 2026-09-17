import * as THREE from 'three';
import { BOX_VALUES } from '../sdk-core/index.ts';
import { refreshBlendBounds } from './webgpuBlendWorlds.ts';
import {
  FLAG_BACK,
  FLAG_DOUBLE,
  FLAG_HAS_NORMAL,
  FLAG_HAS_TANGENT,
  FLAG_LIT,
  FLAG_PAGED,
  FLAG_TRANSMISSIVE,
  isTransmissive,
  visMaterial,
} from './visibilityBuffer.ts';
import { wrapModes } from './visibilityWrapModes.ts';
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
    const uv = paged ? undefined : ensureBlendUvBuffer(device, copy.geometry.attributes, gpu);
    const tangentAttr = copy.geometry.attributes.tangent;
    const normal = paged
      ? undefined
      : ensureBlendNormalBuffer(device, copy.geometry.attributes, gpu);
    const hasNormal = paged ? !!copy.geometry.attributes.normal : !!normal;
    const opacity = Array.isArray(copy.material)
      ? ((copy.material[0] as THREE.MeshBasicMaterial).opacity ?? 1)
      : ((copy.material as THREE.MeshBasicMaterial).opacity ?? 1);
    let flags = 0;
    if (mat.lit) flags |= FLAG_LIT;
    if (mat.doubleSided) flags |= FLAG_DOUBLE;
    if (hasNormal) flags |= FLAG_HAS_NORMAL;
    if (tangentAttr) flags |= FLAG_HAS_TANGENT;
    if (mat.backSide) flags |= FLAG_BACK;
    if (paged) flags |= FLAG_PAGED;
    if (transmits) flags |= FLAG_TRANSMISSIVE;
    // Aucune transformation n'est cuite ici : l'item porte la matrice monde vivante de son maillage
    // source, et sa boîte est POSÉE par le même chemin que celui qui la reprendra après un
    // déplacement. La boîte monde reste conservative sous rotation, miroir, échelle non uniforme et
    // cisaillement — c'est `boxTransform` qui le garantit, pas une décomposition.
    let worldBox: Float64Array | undefined;
    if (copy.frustumCulled) {
      if (!copy.geometry.boundingBox) copy.geometry.computeBoundingBox();
      if (copy.geometry.boundingBox) worldBox = new Float64Array(BOX_VALUES);
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
      worldBox,
      bounds: undefined as Float64Array | undefined,
      rgba: [mat.baseColor[0], mat.baseColor[1], mat.baseColor[2], opacity] as [
        number,
        number,
        number,
        number,
      ],
      map: mat.map,
      flags,
      // Chaque carte du matériau adresse sa texture dans son propre mode, comme une page opaque.
      wrapModes: wrapModes(mat),
      paged,
      // Reposés par `refreshEyeKeys` avant chaque tri ; ici seulement pour qu'ils existent.
      orderKey: 0,
      orderRank: 0,
    };
    refreshBlendBounds(item);
    blendState.blendGpu.push(item);
    if (paged && item.sourceMesh) blendState.pagedBlendGpu.set(item.sourceMesh, item);
    scene.remove(copy);
  }
  return transmissive;
}
