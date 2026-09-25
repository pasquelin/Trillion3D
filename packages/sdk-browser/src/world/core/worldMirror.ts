/**
 * THE GRAPH A WORLD BUILT IN CODE IS DRAWN THROUGH — one mesh per resource, never one per
 * placement.
 *
 * The engine paths read a scene as a host graph: meshes holding a geometry and a surface
 * (`host/scene/graphNodes.ts`). A world hands them one host mesh per drawn resource — a geometry
 * resource worn with one material entry — whose association carries the resource's instance
 * buffer (`placement/rows.ts`): ten thousand placements of one pebble are one host mesh and ten
 * thousand rows the engine reads in place — a blended or transmissive resource too, whose rows the
 * engine draws one blended draw each. A loaded model's graph is drawn whole, through one host node
 * posed by its world matrix alone. Nothing is decided here: the triangles arrive drawn
 * (`drawn.ts`), the surface is the host family of the material's kind (`worldSurface.ts`), and
 * every node of the graph is one this file built, of the engine's own (`../../host/graph/`).
 */
import { isDrawnNode } from '../../host/graph/kinds.ts';
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import type { Material } from '../../../../sdk-core/src/world/material/material.ts';
import type { DrawnTriangles } from '../../../../sdk-core/src/world/geometry/drawn.ts';
import type { PlacementRows } from '../../placement/rows.ts';
import { hostSurface, repaintHostSurface } from './worldSurface.ts';
import { HOST_MAPS, type HostTextures } from './worldTextures.ts';
import { GraphAttribute } from '../../host/graph/attributes.ts';
import { GraphGeometry } from '../../host/graph/geometry.ts';
import { GraphGroup, GraphMesh } from '../../host/graph/mesh.ts';
import { type GraphNode } from '../../host/graph/node.ts';
import type { GraphSurface } from '../../host/graph/surface.ts';
import type { GraphTexture } from '../../host/graph/texture.ts';
import type { Cut } from './worldCuts.ts';
import type { PosedTwin } from './worldPoses.ts';

/** The geometry of drawn triangles, under the attribute names a mesh reads. */
function hostGeometry(drawn: DrawnTriangles) {
  const geometry = new GraphGeometry();
  geometry.setAttribute('position', new GraphAttribute(drawn.positions, 3));
  geometry.setAttribute('normal', new GraphAttribute(drawn.normals, 3));
  if (drawn.uvs) geometry.setAttribute('uv', new GraphAttribute(drawn.uvs, 2));
  if (drawn.colors) geometry.setAttribute('color', new GraphAttribute(drawn.colors, 4));
  geometry.setIndex(new GraphAttribute(drawn.indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** What the mirror is built from: the resources placed by rows, the models drawn whole, and the
 *  mesh rank each geometry resource was given in the session's manifest. */
type MirrorInput = {
  placed: readonly { cut: Cut; material: Material; rows: PlacementRows; name: string }[];
  models: readonly { node: Object3D; graph: GraphNode }[];
  rankOf: (cut: Cut) => number;
};

/** The host graph of a world's session, and the twins the world poses before a frame. */
export function buildWorldMirror(input: MirrorInput) {
  const root = new GraphGroup();
  const twins = new Map<Object3D, PosedTwin>();
  const associations = new Map<
    GraphNode,
    { meshes: number; primitives: number; placements?: PlacementRows }
  >();
  const geometries = new Map<Cut, GraphGeometry>(),
    // One surface per material, and a second one when the material asks for vertex colours and
    // is worn by geometries with and without them: the material decides, as in the reference
    // (`material.vertexColors`), and a geometry with no colour has none to tint by.
    surfaces = new Map<Material, GraphSurface[]>(),
    textures: HostTextures = new Map();
  const meshOf = (cut: Cut, material: Material) => {
    let geometry = geometries.get(cut);
    if (!geometry) geometries.set(cut, (geometry = hostGeometry(cut.drawn)));
    const tinted = material.vertexColors && !!cut.drawn.colors;
    let worn = surfaces.get(material);
    if (!worn) surfaces.set(material, (worn = []));
    const surface = (worn[+tinted] ??= hostSurface(material, tinted, textures));
    return new GraphMesh(geometry, surface);
  };
  for (const { cut, material, rows, name } of input.placed) {
    const mesh = meshOf(cut, material);
    mesh.name = name;
    associations.set(mesh, { meshes: input.rankOf(cut), primitives: 0, placements: rows });
    root.add(mesh);
  }
  for (const { node, graph } of input.models) {
    const twin = new GraphGroup();
    twin.add(graph);
    twin.name = node.name;
    twin.matrixAutoUpdate = false;
    twin.matrix.fromArray(node.matrixWorld.elements);
    root.add(twin);
    twins.set(node, twin);
  }
  /** Writes a repainted material entry's values into the host surface built for it; false when
   *  this mirror built none. */
  const repaint = (material: Material) => {
    const worn = surfaces.get(material);
    for (const surface of worn ?? []) if (surface) repaintHostSurface(surface, material);
    return !!worn;
  };
  return { root, twins, associations, repaint };
}

/** Gives back the geometries, surfaces and textures a mirror built, each once however many
 *  host meshes share it; a loaded model's are kept. */
export function releaseWorldMirror(root: GraphNode) {
  const released = new Set<object>();
  for (const twin of root.children) {
    if (!isDrawnNode(twin)) continue;
    const { geometry, material } = twin;
    const surface = material as GraphSurface;
    for (const owned of [geometry, surface] as { dispose(): void }[])
      if (!released.has(owned)) {
        released.add(owned);
        owned.dispose();
        if (owned === surface)
          for (const field of HOST_MAPS) {
            const texture = surface[field] as GraphTexture | null | undefined;
            if (texture && !released.has(texture)) {
              released.add(texture);
              texture.dispose();
            }
          }
      }
  }
}
