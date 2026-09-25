/**
 * The nodes of the engine's own graph that draw: a mesh wearing a geometry and its surface, the
 * morph weights included, at one placement or several — each copied as the reference copies it.
 * A node that only holds others is the core's own `Group`.
 */
import { BufferAttribute } from '../../../../sdk-core/src/world/buffer/attribute.ts';
import type { GraphSurface } from './surface.ts';
import { GraphNode } from './node.ts';
import type { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts';

/** A drawn node: a geometry and its surface, or one surface per geometry group. */
export class GraphMesh extends GraphNode {
  /** Drawn at one placement, or at several (`GraphInstancedMesh`). */
  override readonly kind: 'mesh' | 'instancedMesh' = 'mesh';
  /** The weight of each morph target, when the geometry declares any. */
  declare morphTargetInfluences?: number[];
  /** The rank of each morph target by its name. */
  declare morphTargetDictionary?: Record<string, number>;
  /** Its shape. */
  geometry: Geometry;
  /** Its surface, or one per geometry group. */
  material: GraphSurface | GraphSurface[];
  constructor(geometry: Geometry, material: GraphSurface | GraphSurface[]) {
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

/**
 * A mesh drawn at several placements in one submission: one matrix per placement in
 * `instanceMatrix`, sixteen numbers each, and `count` of them drawn.
 */
export class GraphInstancedMesh extends GraphMesh {
  override readonly kind = 'instancedMesh' as const;
  /** One matrix per placement, column after column. */
  readonly instanceMatrix: BufferAttribute;
  /** How many placements are drawn. */
  count: number;
  constructor(geometry: Geometry, material: GraphSurface | GraphSurface[], capacity: number) {
    super(geometry, material);
    this.instanceMatrix = new BufferAttribute(new Float32Array(capacity * 16), 16);
    this.count = capacity;
  }
  protected override blank(): this {
    return new GraphInstancedMesh(this.geometry, this.material, this.instanceMatrix.count) as this;
  }
  /** The reference's copy: the placements' matrices and their count come along. */
  override copy(source: GraphNode, recursive = true) {
    super.copy(source, recursive);
    const instanced = source as GraphInstancedMesh;
    const from = instanced.instanceMatrix.array;
    this.instanceMatrix.array.set(from.subarray(0, this.instanceMatrix.array.length));
    this.instanceMatrix.needsUpdate = true;
    this.count = Math.min(instanced.count, this.instanceMatrix.count);
    return this;
  }
  /** Called when the matrices are given back: what a renderer's copy of them listens to. */
  readonly released = new Set<() => void>();
  /** Gives the matrices back; the geometry and the surface are released by their owners. */
  dispose() {
    for (const hook of this.released) hook();
    this.released.clear();
  }
}
