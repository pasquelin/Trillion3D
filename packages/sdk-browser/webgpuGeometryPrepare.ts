import type * as THREE from 'three';
import type { PageRec } from './pageSelection.ts';
type GeometryBlock = {
  vertexBase: number;
  count: number;
  hasUv: boolean;
  hasNormal: boolean;
  hasTangent: boolean;
};
type GeometryBlocks = Map<THREE.BufferGeometry['attributes'], GeometryBlock>;

/** Packs each unique opaque geometry once for visibility and shade passes. */
export function prepareWebgpuGeometry(
  device: GPUDevice,
  allPages: PageRec[],
  geometryBlocks: GeometryBlocks,
) {
  let vertexCount = 0;
  for (const rec of allPages) {
    if (rec.transparent || geometryBlocks.has(rec.attributes)) continue;
    const n = rec.attributes.position?.count ?? 0;
    geometryBlocks.set(rec.attributes, {
      vertexBase: vertexCount,
      count: n,
      hasUv: !!rec.attributes.uv,
      hasNormal: !!rec.attributes.normal,
      hasTangent: !!rec.attributes.tangent,
    });
    vertexCount += n;
  }
  vertexCount = Math.max(1, vertexCount);
  const pos = new Float32Array(vertexCount * 3),
    uv = new Float32Array(vertexCount * 2),
    nrm = new Float32Array(vertexCount * 7),
    filled = new Set<THREE.BufferGeometry['attributes']>();
  for (const rec of allPages) {
    if (rec.transparent || filled.has(rec.attributes)) continue;
    filled.add(rec.attributes);
    const block = geometryBlocks.get(rec.attributes)!;
    const p = rec.attributes.position,
      u = rec.attributes.uv,
      n = rec.attributes.normal,
      t = rec.attributes.tangent;
    for (let i = 0; i < block.count; i++) {
      const o = block.vertexBase + i;
      if (p) {
        pos[o * 3] = p.getX(i);
        pos[o * 3 + 1] = p.getY(i);
        pos[o * 3 + 2] = p.getZ(i);
      }
      if (u) {
        uv[o * 2] = u.getX(i);
        uv[o * 2 + 1] = u.getY(i);
      }
      if (t) {
        nrm[o * 7 + 3] = t.getX(i);
        nrm[o * 7 + 4] = t.getY(i);
        nrm[o * 7 + 5] = t.getZ(i);
        nrm[o * 7 + 6] = t.getW(i);
      }
      if (n) {
        nrm[o * 7] = n.getX(i);
        nrm[o * 7 + 1] = n.getY(i);
        nrm[o * 7 + 2] = n.getZ(i);
      }
    }
  }
  const upload = (data: Float32Array) => {
    const buffer = device.createBuffer({
      size: Math.max(4, data.byteLength),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(
      buffer,
      0,
      data.buffer as ArrayBuffer,
      data.byteOffset,
      data.byteLength,
    );
    return buffer;
  };
  return { concatPos: upload(pos), concatUv: upload(uv), concatNrm: upload(nrm) };
}
