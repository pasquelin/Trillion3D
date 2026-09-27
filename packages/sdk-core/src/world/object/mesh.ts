import { Object3D } from './object3d.ts';
import { takeSerial } from './objectSpace.ts';
import { Geometry } from '../geometry/geometry.ts';
import { Material } from '../material/material.ts';
import type { Box3 } from '../math/box3.ts';
import { ObjectPhysics } from '../../physics/objectPhysics.ts';
import type { PhysicsOption } from '../../physics/options.ts';

/** How the triangles a mesh draws are read from its geometry. */
export type Primitive =
  'triangles' | 'points' | 'lineStrip' | 'lineSegments' | 'lineLoop' | 'sprite';

/** What a mesh hears: a holder whose changes it is told of, when the holder tells any. */
type Heard = { readonly _listeners?: Set<() => void> };

/**
 * Shape and matter placed in the scene. Replacing either, or writing into either, reaches the
 * world: the geometry's and the material's changes are heard for as long as this mesh wears them.
 * The engine draws its own meshes with its own surfaces (`M`); a page's wear a `Material`.
 */
export class Mesh<M extends object = Material> extends Object3D {
  /** Always `true`: tells a mesh apart from any other object. */
  readonly isMesh = true as const;
  // In creation order: a draw breaks ties with it, a diagnostic seeds a colour with it.
  /** The node's number, unique in the session. */
  readonly serial = takeSerial();
  /** The weight of each morph target, when the geometry declares any. */
  morphTargetInfluences?: number[];
  /** The rank of each morph target by its name. */
  morphTargetDictionary?: Record<string, number>;
  private _geometry: Geometry;
  private _material: M | M[];
  private readonly heard = () => this._link?.content(this);
  private _physics: ObjectPhysics | null = null;

  /** How the geometry's vertices are read: triangles, points or lines. */
  readonly primitive: Primitive;
  constructor(
    geometry: Geometry = new Geometry(),
    material: M | M[] = new Material('meshBasic') as unknown as M,
    primitive: Primitive = 'triangles',
  ) {
    super();
    this.castShadow = true;
    this.primitive = primitive;
    this.type = primitive === 'triangles' ? 'Mesh' : primitive;
    this._geometry = geometry;
    this._material = material;
    this.hear(true);
    this.updateMorphTargets();
  }
  private hear(on: boolean) {
    const materials = Array.isArray(this._material) ? this._material : [this._material];
    // A mesh wearing the engine's own surfaces, which tell nothing, is the engine's: never a
    // world's, it hears nothing, and its shared geometry holds no listener of it.
    if (materials.some((material) => !(material as Heard)._listeners)) return;
    for (const holder of [this._geometry, ...materials] as Heard[])
      if (on) holder._listeners?.add(this.heard);
      else holder._listeners?.delete(this.heard);
  }
  /** One zero weight per morph target of the first morphed attribute, named by rank. */
  updateMorphTargets() {
    const morphs = this._geometry.morphAttributes;
    const first = Object.keys(morphs)[0];
    if (first === undefined) return;
    const influences: number[] = (this.morphTargetInfluences = []);
    const dictionary: Record<string, number> = (this.morphTargetDictionary = {});
    morphs[first].forEach((target, rank) => {
      influences.push(0);
      dictionary[target.name || String(rank)] = rank;
    });
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
  get material(): M | M[] {
    return this._material;
  }
  set material(material: M | M[]) {
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
  // The reference's copy: the morph weights copied, the geometry shared, the materials listed anew.
  override copy(source: Object3D, recursive = true) {
    super.copy(source, recursive);
    const mesh = source as Mesh<M>;
    if (mesh.morphTargetInfluences) this.morphTargetInfluences = mesh.morphTargetInfluences.slice();
    if (mesh.morphTargetDictionary) this.morphTargetDictionary = { ...mesh.morphTargetDictionary };
    const worn = mesh.material;
    if (Array.isArray(worn) || worn !== this._material)
      this.material = Array.isArray(worn) ? worn.slice() : worn;
    if (mesh.geometry !== this._geometry) this.geometry = mesh.geometry;
    return this;
  }
  override localBounds(): Box3 | null {
    return this._geometry.boundingBox ?? this._geometry.computeBoundingBox();
  }
}
