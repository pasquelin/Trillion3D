import { BufferAttribute } from '../buffer/attribute.ts';
import type { Geometry } from '../geometry/geometry.ts';
import type { Material } from '../material/material.ts';
import { Mesh } from './mesh.ts';
import type { Object3D } from './object3d.ts';

/**
 * A mesh drawn at several placements in one submission: one matrix per placement in
 * `instanceMatrix`, sixteen numbers each, and `count` of them drawn.
 */
export class InstancedMesh<M extends object = Material> extends Mesh<M> {
  /** Always `true`: tells a mesh drawn at several placements apart. */
  readonly isInstancedMesh = true as const;
  /** One matrix per placement, column after column. */
  readonly instanceMatrix: BufferAttribute;
  /** How many placements are drawn. */
  count: number;
  constructor(geometry: Geometry, material: M | M[], capacity: number) {
    super(geometry, material);
    this.instanceMatrix = new BufferAttribute(new Float32Array(capacity * 16), 16);
    this.count = capacity;
  }
  protected override blank(): this {
    return new InstancedMesh(this.geometry, this.material, this.instanceMatrix.count) as this;
  }
  /** The reference's copy: the placements' matrices and their count come along. */
  override copy(source: Object3D, recursive = true) {
    super.copy(source, recursive);
    const instanced = source as InstancedMesh<M>;
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
