import * as THREE from 'three';
import {
  FLAG_BACK,
  FLAG_DOUBLE,
  FLAG_HAS_NORMAL,
  FLAG_HAS_TANGENT,
  FLAG_LIT,
  FLAG_PAGED,
  FLAG_WRAP_S_REPEAT,
  FLAG_WRAP_T_REPEAT,
  isTransmissive,
  visMaterial,
} from './visibilityBuffer.ts';
import { ensureWebgpuPositionBuffer } from './webgpuPositions.ts';
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
  directCanvas: boolean,
) {
  let transmissive = 0;
  for (const copy of blendCopies) {
    if (isTransmissive(copy.material)) {
      // No pass reads the image behind a surface yet, so such a surface is not drawn at all. The
      // caller says so out loud rather than letting the scene lose a plane of water in silence.
      transmissive++;
      if (directCanvas) throw new Error('UNSUPPORTED_TRANSMISSION');
      continue;
    }
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
    const src = idx.array;
    // A paged primitive reads its indices from the page cache, cluster by cluster: it owns none.
    let index: GPUBuffer | undefined;
    if (!paged) {
      const indexData =
        src instanceof Uint32Array ? src : new Uint32Array(src as ArrayLike<number>);
      index = device.createBuffer({
        size: Math.max(4, indexData.byteLength),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(
        index,
        0,
        indexData.buffer,
        indexData.byteOffset,
        indexData.byteLength,
      );
    }
    const uvAttr = copy.geometry.attributes.uv;
    let uv: GPUBuffer | undefined;
    if (uvAttr) {
      const uvData = new Float32Array(uvAttr.count * 2);
      for (let i = 0; i < uvAttr.count; i++) {
        uvData[i * 2] = uvAttr.getX(i);
        uvData[i * 2 + 1] = uvAttr.getY(i);
      }
      uv = device.createBuffer({
        size: Math.max(8, uvData.byteLength),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(
        uv,
        0,
        uvData.buffer as ArrayBuffer,
        uvData.byteOffset,
        uvData.byteLength,
      );
    }
    const normalAttr = copy.geometry.attributes.normal,
      tangentAttr = copy.geometry.attributes.tangent;
    let normal: GPUBuffer | undefined;
    if (normalAttr) {
      const data = new Float32Array(normalAttr.count * 7);
      for (let i = 0; i < normalAttr.count; i++) {
        data[i * 7] = normalAttr.getX(i);
        data[i * 7 + 1] = normalAttr.getY(i);
        data[i * 7 + 2] = normalAttr.getZ(i);
        if (tangentAttr) {
          data[i * 7 + 3] = tangentAttr.getX(i);
          data[i * 7 + 4] = tangentAttr.getY(i);
          data[i * 7 + 5] = tangentAttr.getZ(i);
          data[i * 7 + 6] = tangentAttr.getW(i);
        }
      }
      normal = device.createBuffer({
        size: Math.max(12, data.byteLength),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(normal, 0, data);
    }
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
    gpu.vertexBytes += (index?.size ?? 0) + (uv?.size ?? 0) + (normal?.size ?? 0);
    if (paged && item.sourceMesh) blendState.pagedBlendGpu.set(item.sourceMesh, item);
    scene.remove(copy);
  }
  return transmissive;
}
