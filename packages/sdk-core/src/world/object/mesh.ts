import { Object3D } from './object3d.ts';
import { Geometry } from '../geometry/geometry.ts';
import { Material } from '../material/material.ts';
import type { Box3 } from '../math/box3.ts';
import { ObjectPhysics } from '../../physics/objectPhysics.ts';
import type { PhysicsOption } from '../../physics/options.ts';

/** How the triangles a mesh draws are read from its geometry. */
export type Primitive =
  'triangles' | 'points' | 'lineStrip' | 'lineSegments' | 'lineLoop' | 'sprite';

/** What a mesh in a world hears: a holder whose changes it is told of, when the holder tells any
 *  (the engine's own surfaces tell nothing). */
type Heard = { readonly _listeners?: Set<() => void> };

/**
 * Shape and matter placed in the scene. Replacing either, or writing into either, reaches the
 * world: the geometry's and the material's changes are heard for as long as this mesh wears them.
 * The engine draws its own meshes with its own surfaces (`M`); a page's wear a `Material`.
 */
export class Mesh<M extends object = Material> extends Object3D {
  /** Always `true`: tells a mesh apart from any other object. */
  get isMesh(): true {
    return true;
  }
  // Written only when a morph exists or a body is set: a mesh holds its shape and matter alone.
  /** The weight of each morph target, when the geometry declares any. */
  declare morphTargetInfluences?: number[];
  /** The rank of each morph target by its name. */
  declare morphTargetDictionary?: Record<string, number>;
  declare private _physics?: ObjectPhysics | null;
  /** What the geometry and materials call while the mesh is in a world; made on its first entry. */
  declare private _heard?: () => void;
  private _geometry: Geometry;
  private _material: M | M[];

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
    this.updateMorphTargets();
  }
  /** Tells the world this mesh is in that its content changed. */
  private heard() {
    this._link?.content(this);
  }
  /** Its geometry and materials start telling it their changes (`on`), or stop. */
  private hear(on: boolean) {
    const heard = (this._heard ??= () => this.heard());
    const materials = Array.isArray(this._material) ? this._material : [this._material];
    for (const holder of [this._geometry, ...materials] as Heard[])
      if (on) holder._listeners?.add(heard);
      else holder._listeners?.delete(heard);
  }
  /** Only a mesh in a world is heard: out of one, nothing it holds keeps a reference to it. */
  protected override linked(inWorld: boolean) {
    this.hear(inWorld);
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
    this.wear(() => (this._geometry = geometry));
  }
  /** The mesh's material, or one per group; set another to change it. */
  get material(): M | M[] {
    return this._material;
  }
  set material(material: M | M[]) {
    this.wear(() => (this._material = material));
  }
  /** Puts on another geometry or material: heard from the new one when in a world, which is told. */
  private wear(change: () => void) {
    const inWorld = !!this._link;
    if (inWorld) this.hear(false);
    change();
    if (inWorld) this.hear(true);
    this.heard();
  }
  /**
   * The mesh as a body of the world's physics, `null` when it is none. Set `'static'`,
   * `'dynamic'`, `'kinematic'` or options; the shape is inferred from the geometry.
   * @defaultValue null
   * @example box.physics = 'dynamic'; box.physics.applyImpulse(0, 5, 0);
   */
  get physics(): ObjectPhysics | null {
    return this._physics ?? null;
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
    // A bare node or a group gives its transform alone: it wears no shape and no matter.
    if (!(source instanceof Mesh)) return this;
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
