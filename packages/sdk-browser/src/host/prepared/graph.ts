/**
 * The host scene graph of the prepared scene, assembled from the node table under the rules the
 * host loader applied, since the scene the engine draws is proven by being the same scene:
 *
 * - a node carrying one thing IS that thing (a mesh, a camera, a light), one carrying several is a group of
 *   them, one carrying nothing is a bare node; its children follow what it carries;
 * - a mesh of one primitive is one host mesh, a mesh of several a group of one host mesh each;
 * - a mesh, a camera or a light several nodes name is copied per node, the copies sharing geometry and
 *   surface, and named `_instance_<n>` in turn;
 * - names are made unique in the order the loader reserved them: scene, then each node, its
 *   camera and its light depth first, then each mesh as its surfaces are ready — in the order
 *   they are first named when they are ready together, in the order their images land when not;
 * - a node's pose is set from what it declares: a matrix decomposed, or its translation, rotation
 *   and scale as they are — so the engine composes the same world matrices from them.
 */
import type { PreparedSceneTables } from '../../../../sdk-core/src/scene/core/tableContracts.ts';
import type { TableDocument } from '../../../../sdk-core/src/scene/core/tableDocuments.ts';
import { camera, light, pose, uniqueNames, weigh } from './nodes.ts';
import type { SurfaceVariant } from './materials.ts';
import type { GraphGeometry } from '../graph/geometry.ts';
import type { GraphSurface } from '../graph/surface.ts';
import { GraphGroup, GraphMesh } from '../graph/mesh.ts';
import { GraphNode } from '../graph/node.ts';
import { type GraphCamera } from '../graph/camera.ts';
import { type GraphLight } from '../graph/light.ts';

/** What the engine knows a drawn mesh by: its mesh and primitive ranks. */
export type MeshRanks = { meshes?: number; primitives?: number };

type Inputs = {
  tables: PreparedSceneTables;
  meshes: TableDocument['meshes'];
  geometryOf: (mesh: number, primitive: number) => GraphGeometry;
  materialOf: (rank: number, variant: SurfaceVariant) => Promise<GraphSurface>;
};

/** The prepared scene as a host graph, and the ranks each drawn host mesh answers to. */
export async function preparedGraph({ tables, meshes, geometryOf, materialOf }: Inputs) {
  const unique = uniqueNames();
  const ranks = new Map<GraphNode, MeshRanks>();
  const scene = new GraphGroup();
  if (tables.scene.name) scene.name = unique(tables.scene.name);
  // References are counted over every node, reached or not, as the loader counted them.
  const refs = (field: 'mesh' | 'light' | 'camera') => {
    const counts = new Map<number, number>();
    for (const node of tables.nodes)
      if (node[field] !== null) counts.set(node[field], (counts.get(node[field]) ?? 0) + 1);
    return counts;
  };
  const counts = { mesh: refs('mesh'), light: refs('light'), camera: refs('camera') };
  const uses = new Map<string, number>();
  /** The object a node names, or its copy when several nodes name it. */
  const reference = (kind: keyof typeof counts, rank: number, made: GraphNode) => {
    if ((counts[kind].get(rank) ?? 0) <= 1) return made;
    const copy = made.clone();
    const walk = (from: GraphNode, to: GraphNode) => {
      const held = ranks.get(from);
      if (held) ranks.set(to, held);
      from.children.forEach((child, i) => walk(child, to.children[i]));
    };
    walk(made, copy);
    const key = `${kind}:${rank}`;
    const use = uses.get(key) ?? 0;
    uses.set(key, use + 1);
    copy.name += `_instance_${use}`;
    return copy;
  };
  // Names first, depth first: node, then its camera, then its light; each camera and each light
  // is built at its first use.
  const cameras = new Map<number, GraphCamera>();
  const lights = new Map<number, GraphLight>();
  const nodeNames = new Map<number, string>();
  const order: number[] = [];
  const named = new Set<number>();
  const reserve = (id: number) => {
    const node = tables.nodes[id];
    nodeNames.set(id, node.name ? unique(node.name) : '');
    if (node.mesh !== null && !named.has(node.mesh)) {
      named.add(node.mesh);
      order.push(node.mesh);
    }
    if (node.camera !== null && !cameras.has(node.camera)) {
      const declared = tables.cameras[node.camera];
      const made = camera(declared);
      if (declared.name) made.name = unique(declared.name);
      cameras.set(node.camera, made);
    }
    if (node.light !== null && !lights.has(node.light)) {
      const declared = tables.lights[node.light];
      lights.set(node.light, light(declared, unique(declared.name || `light_${node.light}`)));
    }
    for (const child of node.children) reserve(child);
  };
  for (const root of tables.scene.nodes) reserve(root);
  // Meshes, in the order they were first named. Every surface is asked for before any is waited
  // on: their images load together, as the loader loaded them.
  const drawn = order.map((rank) =>
    meshes[rank].primitives.map((primitive, p) => {
      const geometry = geometryOf(rank, p);
      const variant = {
        vertexColors: geometry.attributes.color !== undefined,
        flatShading: geometry.attributes.normal === undefined,
      };
      return { geometry, material: materialOf(primitive.material, variant) };
    }),
  );
  // Each mesh is named when its surfaces are ready, as the loader named it: meshes whose
  // surfaces land together keep the order they were first named in.
  const built = new Map<number, GraphNode>();
  await Promise.all(
    order.map((rank, at) =>
      Promise.all(drawn[at].map(({ material }) => material)).then((surfaces) => {
        const parts = drawn[at].map(({ geometry }, p) => {
          const mesh = new GraphMesh(geometry, surfaces[p]);
          if (Object.keys(geometry.morphAttributes).length) weigh(mesh, meshes[rank].weights);
          mesh.name = unique(meshes[rank].name || `mesh_${rank}`);
          ranks.set(mesh, { meshes: rank, primitives: p });
          return mesh;
        });
        if (parts.length === 1) built.set(rank, parts[0]);
        else {
          const group = new GraphGroup();
          ranks.set(group, { meshes: rank });
          for (const part of parts) group.add(part);
          built.set(rank, group);
        }
      }),
    ),
  );
  const assemble = (id: number): GraphNode => {
    const declared = tables.nodes[id];
    const carried: GraphNode[] = [];
    if (declared.mesh !== null) {
      const mesh = reference('mesh', declared.mesh, built.get(declared.mesh)!);
      // Weights a node declares override its mesh's, on every primitive it draws.
      if (declared.weights) mesh.traverse((part) => weigh(part as GraphMesh, declared.weights));
      carried.push(mesh);
    }
    if (declared.camera !== null)
      carried.push(reference('camera', declared.camera, cameras.get(declared.camera)!));
    if (declared.light !== null)
      carried.push(reference('light', declared.light, lights.get(declared.light)!));
    const node =
      carried.length === 1
        ? carried[0]
        : carried.length
          ? new GraphGroup().add(...carried)
          : new GraphNode();
    if (declared.name) {
      node.userData.name = declared.name;
      node.name = nodeNames.get(id)!;
    }
    pose(node, declared);
    for (const child of declared.children) node.add(assemble(child));
    return node;
  };
  for (const root of tables.scene.nodes) scene.add(assemble(root));
  return { scene, ranks };
}
