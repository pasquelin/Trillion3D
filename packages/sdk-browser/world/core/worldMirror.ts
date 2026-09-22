/**
 * THE HOST-LIBRARY OBJECTS A WORLD BUILT IN CODE IS DRAWN THROUGH — one per resource, never one
 * per placement.
 *
 * The engine paths read a scene as a host graph: meshes holding a geometry and a surface
 * (`hostGraphNodes.ts`). A world hands them one host mesh per drawn resource — a geometry
 * resource worn with one material entry — whose association carries the resource's instance
 * buffer (`placementRows.ts`): ten thousand placements of one pebble are one host mesh and ten
 * thousand rows the engine reads in place — a blended or transmissive resource too, whose rows the
 * engine draws one blended draw each. A loaded model's graph is drawn whole, through one host node
 * posed by its world matrix alone. Nothing is decided here: the triangles arrive drawn
 * (`drawn.ts`), the surface is the host family of the material's kind (`worldSurface.ts`), and
 * every host object handed to a host method is one this file built.
 */
import * as THREE from 'three';
import type { Object3D } from '../../../sdk-core/world/object/object3d.ts';
import type { Material } from '../../../sdk-core/world/material/material.ts';
import type { DrawnTriangles } from '../../../sdk-core/world/geometry/drawn.ts';
import type { PlacementRows } from '../../placement/placementRows.ts';
import { HOST_MAPS, hostSurface } from './worldSurface.ts';
import type { Cut } from './worldCuts.ts';
import type { PosedTwin } from './worldPoses.ts';

/** The host geometry of drawn triangles, under the attribute names a host mesh reads. */
function hostGeometry(drawn: DrawnTriangles) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(drawn.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(drawn.normals, 3));
  if (drawn.uvs) geometry.setAttribute('uv', new THREE.BufferAttribute(drawn.uvs, 2));
  if (drawn.colors) geometry.setAttribute('color', new THREE.BufferAttribute(drawn.colors, 4));
  geometry.setIndex(new THREE.BufferAttribute(drawn.indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** What the mirror is built from: the resources placed by rows, the models drawn whole, and the
 *  mesh rank each geometry resource was given in the session's manifest. */
export type MirrorInput = {
  placed: readonly { cut: Cut; material: Material; rows: PlacementRows; name: string }[];
  models: readonly { node: Object3D; graph: THREE.Object3D }[];
  rankOf: (cut: Cut) => number;
};

/** The host graph of a world's session, and the twins the world poses before a frame. */
export function buildWorldMirror(input: MirrorInput) {
  const root = new THREE.Group();
  const twins = new Map<Object3D, PosedTwin>();
  const associations = new Map<
    THREE.Object3D,
    { meshes: number; primitives: number; placements?: PlacementRows }
  >();
  const geometries = new Map<Cut, THREE.BufferGeometry>(),
    surfaces = new Map<Material, THREE.Material>();
  const meshOf = (cut: Cut, material: Material) => {
    let geometry = geometries.get(cut);
    if (!geometry) geometries.set(cut, (geometry = hostGeometry(cut.drawn)));
    let surface = surfaces.get(material);
    if (!surface) surfaces.set(material, (surface = hostSurface(material, !!cut.drawn.colors)));
    return new THREE.Mesh(geometry, surface);
  };
  for (const { cut, material, rows, name } of input.placed) {
    const mesh = meshOf(cut, material);
    mesh.name = name;
    associations.set(mesh, { meshes: input.rankOf(cut), primitives: 0, placements: rows });
    root.add(mesh);
  }
  for (const { node, graph } of input.models) {
    const twin = new THREE.Group();
    twin.add(graph);
    twin.name = node.name;
    twin.matrixAutoUpdate = false;
    twin.matrix.fromArray(node.matrixWorld.elements);
    root.add(twin);
    twins.set(node, twin);
  }
  return { root, twins, associations };
}

/** Gives back the geometries, surfaces and textures a mirror built, each once however many
 *  host meshes share it; a loaded model's are kept. */
export function releaseWorldMirror(root: THREE.Object3D) {
  const released = new Set<object>();
  for (const twin of root.children) {
    if (!(twin instanceof THREE.Mesh)) continue;
    const surface = twin.material as THREE.Material & Record<string, unknown>;
    for (const owned of [twin.geometry, surface] as { dispose(): void }[])
      if (!released.has(owned)) {
        released.add(owned);
        owned.dispose();
        if (owned === surface)
          for (const field of HOST_MAPS)
            (surface[field] as THREE.Texture | null | undefined)?.dispose();
      }
  }
}
