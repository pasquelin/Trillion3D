import { Object3D } from './object3d.ts';
import { Geometry } from '../geometry/geometry.ts';
import { Material } from '../material/material.ts';
import type { Box3 } from '../math/box3.ts';
import { ObjectPhysics } from '../../physics/objectPhysics.ts';
import type { PhysicsOption } from '../../physics/options.ts';

/** How the triangles a mesh draws are read from its geometry. */
export type Primitive =
  'triangles' | 'points' | 'lineStrip' | 'lineSegments' | 'lineLoop' | 'sprite';

/**
 * Shape and matter placed in the scene. Replacing either, or writing into either, reaches the
 * world: the geometry's and the material's changes are heard for as long as this mesh wears them.
 */
export class Mesh extends Object3D {
  /** Always `true`: tells a mesh apart from any other object. */
  readonly isMesh = true as const;
  private _geometry: Geometry;
  private _material: Material | Material[];
  private readonly heard = () => this._link?.content(this);
  private _physics: ObjectPhysics | null = null;

  /** How the geometry's vertices are read: triangles, points or lines. */
  readonly primitive: Primitive;
  constructor(
    geometry: Geometry = new Geometry(),
    material: Material | Material[] = new Material('meshBasic'),
    primitive: Primitive = 'triangles',
  ) {
    super();
    this.primitive = primitive;
    this.type = primitive === 'triangles' ? 'Mesh' : primitive;
    this._geometry = geometry;
    this._material = material;
    this.hear(true);
  }
  private hear(on: boolean) {
    const materials = Array.isArray(this._material) ? this._material : [this._material];
    for (const holder of [this._geometry, ...materials])
      if (on) holder._listeners.add(this.heard);
      else holder._listeners.delete(this.heard);
  }
  /** The mesh's shape; set another geometry to change it. */
  get geometry() {
    return this._geometry;
  }
  set geometry(geometry: Geometry) {
    this.hear(false);
    this._geometry = geometry;
    this.hear(true);
    this.heard();
  }
  /** The mesh's material, or one per group; set another to change it. */
  get material() {
    return this._material;
  }
  set material(material: Material | Material[]) {
    this.hear(false);
    this._material = material;
    this.hear(true);
    this.heard();
  }
  /**
   * The mesh as a body of the world's physics, `null` when it is none. Set `'static'`,
   * `'dynamic'`, `'kinematic'` or options; the shape is inferred from the geometry.
   * @defaultValue null
   * @example box.physics = 'dynamic'; box.physics.applyImpulse(0, 5, 0);
   */
  get physics(): ObjectPhysics | null {
    return this._physics;
  }
  set physics(option: PhysicsOption | ObjectPhysics | null) {
    this._physics =
      option === null || option instanceof ObjectPhysics ? option : new ObjectPhysics(option);
    this.heard();
  }
  /** A shallow clone shares this mesh's geometry and material, and keeps its primitive. */
  protected override blank(): this {
    return new Mesh(this.geometry, this.material, this.primitive) as this;
  }
  override localBounds(): Box3 | null {
    return this._geometry.boundingBox ?? this._geometry.computeBoundingBox();
  }
}
