import type { HostAttributes } from '../../host/resources.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import type { GeometryBlock } from '../row/pageRowMaterial.ts';
import { normalBufferFloats, writeVertexColors } from './vertexColors.ts';
type GeometryBlocks = Map<HostAttributes, GeometryBlock>;

/**
 * Packs, once, the source geometry the passes still read as floats: that of the clusters no
 * quantized page covers — a transparent cluster, whose forward draw reads an index buffer, and a
 * cache that carries no geometry page. A cluster drawn from its page contributes no vertex here,
 * and its primitive contributes none unless another of its clusters needs one: that is the whole
 * point of reading a page in place. Vertex colours ride at the tail of the normal buffer
 * (`vertexColors.ts`), which carries none when no packed geometry has any.
 */
export function prepareWebgpuGeometry(
  device: GPUDevice,
  allPages: PageRec[],
  geometryBlocks: GeometryBlocks,
) {
  const sourced = allPages.filter((rec) => !rec.geometryPage);
  let vertexCount = 0,
    coloured = false;
  for (const rec of sourced) {
    if (geometryBlocks.has(rec.attributes)) continue;
    const n = rec.attributes.position?.count ?? 0;
    geometryBlocks.set(rec.attributes, {
      vertexBase: vertexCount,
      count: n,
      hasUv: !!rec.attributes.uv,
      hasNormal: !!rec.attributes.normal,
      hasTangent: !!rec.attributes.tangent,
      hasColor: !!rec.attributes.color,
    });
    coloured ||= !!rec.attributes.color;
    vertexCount += n;
  }
  vertexCount = Math.max(1, vertexCount);
  const pos = new Float32Array(vertexCount * 3),
    uv = new Float32Array(vertexCount * 2),
    nrm = new Float32Array(normalBufferFloats(vertexCount, coloured)),
    filled = new Set<HostAttributes>();
  for (const rec of sourced) {
    if (filled.has(rec.attributes)) continue;
    filled.add(rec.attributes);
    const block = geometryBlocks.get(rec.attributes)!;
    const p = rec.attributes.position,
      u = rec.attributes.uv,
      n = rec.attributes.normal,
      t = rec.attributes.tangent,
      c = rec.attributes.color;
    if (c) writeVertexColors(nrm, vertexCount, block.vertexBase, block.count, c);
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
      label: 'Trillion3D transparent geometry',
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
