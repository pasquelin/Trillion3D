import { wholeDeformationPool } from '../../deformation/wholePool.ts';
import type { BlendGpuItem } from '../blend/state.ts';
import type { HostAttributes } from '../../host/resources.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import type { GeometryBlock } from '../row/pageRowMaterial.ts';
import type { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts';
import type { SessionDeformation } from '../../deformation/session.ts';
import { createVertexPool } from './geometryPool.ts';
export { createVertexPool, type VertexPool } from './geometryPool.ts';
type GeometryBlocks = Map<HostAttributes, GeometryBlock>;
/** What a growth of the pool hands the runtime: the wider buffers and the re-placed block. */
export type VertexPoolGrowth = {
  concatPos: GPUBuffer;
  concatUv: GPUBuffer;
  concatNrm: GPUBuffer;
  wholeDeformation: { table: GPUBuffer; count: number } | undefined;
};

/**
 * Packs, once, the source geometry the passes still read as floats: that of the clusters no
 * quantized page covers, from a cache that carries no geometry page. A cluster drawn from its
 * page contributes no vertex here, and its primitive contributes none unless another of its
 * clusters needs one: that is the whole point of reading a page in place. The float pool it makes
 * (`./geometryPool.ts`) grows its room in place (#1293): `grown` hears each growth with the wider
 * buffers and the deformation block re-placed after them.
 */
export function prepareWebgpuGeometry(
  device: GPUDevice,
  allPages: PageRec[],
  geometryBlocks: GeometryBlocks,
  deformation?: SessionDeformation,
  items: readonly BlendGpuItem[] = [],
  grown?: (update: VertexPoolGrowth) => void,
) {
  const sourced = new Map<HostAttributes, boolean>();
  for (const rec of allPages)
    if (!rec.geometryPage)
      sourced.set(rec.attributes, rec.sourceMesh?.geometry.usage === 'dynamic');
  const whole = wholeDeformationPool(items, deformation);
  for (const item of whole.placed) sourced.set(item.sourceGeometry.attributes, false);
  let vertices = 0,
    room = 0,
    coloured = false;
  for (const [attributes, dynamic] of sourced) {
    const n = attributes.position?.count ?? 0;
    vertices += n;
    if (dynamic) room += n;
    coloured ||= !!attributes.color;
  }
  const capacity = Math.max(1, vertices + room);
  // The deformation records ride after the positions (#357): the passes read them through the
  // binding they already read the positions through.
  const deformFloats = deformation?.floats ?? 0;
  const vertexBase = (geometry: Geometry) => geometryBlocks.get(geometry.attributes)!.vertexBase;
  let wholeDeformation: VertexPoolGrowth['wholeDeformation'];
  /** Places the deformation block after `count` vertices and points the whole copies at it. */
  const placeWhole = (count: number) => {
    deformation?.place(count * 3);
    wholeDeformation = whole.placed.length
      ? whole.upload(device, vertexPool.concatPos, count * 3 + deformFloats, vertexBase)
      : undefined;
    for (const item of whole.placed) {
      item.uv = vertexPool.concatUv;
      item.normal = vertexPool.concatNrm;
    }
  };
  /** A growth of the pool: the deformation block moves after the wider vertices (#1293). */
  const regrow = (count: number) => {
    placeWhole(count);
    grown?.({
      concatPos: vertexPool.concatPos,
      concatUv: vertexPool.concatUv,
      concatNrm: vertexPool.concatNrm,
      wholeDeformation,
    });
  };
  const vertexPool = createVertexPool(
    device,
    capacity,
    coloured,
    geometryBlocks,
    deformFloats + whole.floats,
    regrow,
  );
  vertexPool.pack(sourced);
  placeWhole(capacity);
  const { concatPos, concatUv, concatNrm } = vertexPool;
  return { concatPos, concatUv, concatNrm, vertexPool, wholeDeformation };
}
