/**
 * The nodes of the engine's own graph that hold others or draw: a group, and a mesh wearing a
 * geometry and its surface, the morph weights included — each copied as the reference copies it.
 */
import type { GraphGeometry } from './geometry.ts';
import type { GraphSurface } from './surface.ts';
import { GraphNode } from './node.ts';

/** A node that only holds others. */
export class GraphGroup extends GraphNode {
  /** Always `true`: tells a group apart. */
  readonly isGroup = true as const;
  override type = 'Group';
  protected override blank(): this {
    return new GraphGroup() as this;
  }
}

/** A drawn node: a geometry and its surface, or one surface per geometry group. */
export class GraphMesh extends GraphNode {
  /** Always `true`: tells a drawn node apart. */
  readonly isMesh = true as const;
  override type = 'Mesh';
  /** The weight of each morph target, when the geometry declares any. */
  declare morphTargetInfluences?: number[];
  /** The rank of each morph target by its name. */
  declare morphTargetDictionary?: Record<string, number>;
  /** Its shape. */
  geometry: GraphGeometry;
  /** Its surface, or one per geometry group. */
  material: GraphSurface | GraphSurface[];
  constructor(geometry: GraphGeometry, material: GraphSurface | GraphSurface[]) {
    super();
    this.geometry = geometry;
    this.material = material;
    this.updateMorphTargets();
  }
  /** One zero weight per morph target of the first morphed attribute, named by rank. */
  updateMorphTargets() {
    const morphs = this.geometry.morphAttributes;
    const first = Object.keys(morphs)[0];
    if (first === undefined) return;
    this.morphTargetInfluences = [];
    this.morphTargetDictionary = {};
    morphs[first].forEach((target, rank) => {
      this.morphTargetInfluences!.push(0);
      this.morphTargetDictionary![target.name || String(rank)] = rank;
    });
  }
  protected override blank(): this {
    return new GraphMesh(this.geometry, this.material) as this;
  }
  override copy(source: GraphNode, recursive = true) {
    super.copy(source, recursive);
    const mesh = source as GraphMesh;
    if (mesh.morphTargetInfluences) this.morphTargetInfluences = mesh.morphTargetInfluences.slice();
    if (mesh.morphTargetDictionary) this.morphTargetDictionary = { ...mesh.morphTargetDictionary };
    this.material = Array.isArray(mesh.material) ? mesh.material.slice() : mesh.material;
    this.geometry = mesh.geometry;
    return this;
  }
}
