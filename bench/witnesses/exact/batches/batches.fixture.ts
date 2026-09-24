import * as THREE from 'three';
import { surfaceOf } from '../../../../packages/sdk-browser/src/page/surface.ts';
import { ClusterBatches, type BatchPage } from './batches.ts';
import {
  isClusterDrawMesh,
  type ClusterDrawMesh,
} from '../../../../packages/sdk-browser/src/cluster/batchMesh.ts';

/** The surface a page wears: the engine's record, and the host declaration behind it. */
export const wears = (material: THREE.Material) => ({
  material: surfaceOf(material),
  declaration: material,
});

export function attributes(count: number) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3),
  );
  return geometry.attributes;
}

type Fixture = {
  pages: BatchPage[];
  byUrl: Map<string, BatchPage[]>;
  arrays: Map<string, Uint32Array>;
};

/** Two primitives; the first is instanced twice (renderOrder 0 and 1), the second once (2). */
export function fixture(): Fixture {
  const material = new THREE.MeshBasicMaterial();
  const shared = attributes(64),
    other = attributes(16);
  const pages: BatchPage[] = [];
  const arrays = new Map<string, Uint32Array>();
  const add = (
    renderOrder: number,
    attrs: THREE.BufferGeometry['attributes'],
    id: number,
    url: string,
    triangles: number,
    extra: Partial<BatchPage> = {},
  ) => {
    pages.push({
      id,
      url,
      triangles,
      min: [0, 0, 0],
      max: [1, 1, 1],
      attributes: attrs,
      material: surfaceOf(material),
      declaration: material,
      matrix: new THREE.Matrix4(),
      renderOrder,
      ...extra,
    });
    if (!arrays.has(url))
      arrays.set(
        url,
        Uint32Array.from({ length: triangles * 3 }, (_unused, i) => i),
      );
  };
  for (const renderOrder of [0, 1]) {
    add(renderOrder, shared, 0, 'a', 2);
    add(renderOrder, shared, 1, 'b', 3);
    add(renderOrder, shared, 2, 'c', 1);
  }
  add(2, other, 0, 'd', 4);
  const byUrl = new Map<string, BatchPage[]>();
  for (const page of pages) {
    const list = byUrl.get(page.url) ?? [];
    list.push(page);
    byUrl.set(page.url, list);
  }
  return { pages, byUrl, arrays };
}

export function resident(batches: ClusterBatches, data: Fixture, urls: string[]) {
  for (const url of urls) {
    const array = data.arrays.get(url)!;
    for (const page of data.byUrl.get(url)!) page.array = array;
    batches.acceptPage(data.byUrl.get(url)!, array);
  }
}
/** The draw record of an instance, as the owner receives it. */
export function drawOf(batches: ClusterBatches, renderOrder: number) {
  const mesh = batches.drawList.find(
    (draw): draw is ClusterDrawMesh => isClusterDrawMesh(draw) && draw.renderOrder === renderOrder,
  );
  if (!mesh) return undefined;
  return {
    geometry: mesh.geometry,
    material: mesh.material,
    count: mesh._multiDrawCount,
    starts: [...mesh._multiDrawStarts.subarray(0, mesh._multiDrawCount)],
    counts: [...mesh._multiDrawCounts.subarray(0, mesh._multiDrawCount)],
  };
}
