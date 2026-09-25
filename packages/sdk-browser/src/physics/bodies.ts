import { EngineError } from '../../../sdk-core/src/contracts/cache.ts';
import {
  BODY_INDEX,
  type ObjectPhysics,
  FLAG,
  GENERATION_SHIFT,
  GENERATIONS,
  LAYER,
  MOTION,
  physicsBudgetError,
  physicsMatterOf,
  resolveShape,
  type CommandWriter,
  type PhysicsBudget,
  type PhysicsHost,
} from '../../../sdk-core/src/physics/index.ts';
import { Quaternion } from '../../../sdk-core/src/world/math/quaternion.ts';
import { Vector3 } from '../../../sdk-core/src/world/math/vector3.ts';
import type { Mesh } from '../../../sdk-core/src/world/object/mesh.ts';
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';

const position = new Vector3(),
  turn = new Quaternion();

/** A node's world position and quaternion, in scratch every caller shares: read them at once. */
export function worldPoseOf(node: Object3D) {
  node.updateWorldMatrix(true, false);
  node.getWorldPosition(position);
  node.getWorldQuaternion(turn);
  return { position: position.elements, quaternion: turn.elements };
}

/** A mesh the simulation holds a body for. */
export type Bodied = Mesh & { physics: NonNullable<Mesh['physics']> };

/** Whether `node` is a mesh with physics set. */
export const hasBody = (node: Object3D): node is Bodied =>
  (node as { physics?: unknown }).physics != null;

/** A body's flag bits as its settings ask; a hidden mesh sends no pose. */
export function flagsOf(mesh: Bodied) {
  const p = mesh.physics;
  return (
    (p.sensor ? FLAG.sensor : 0) |
    (p.ccd ? FLAG.ccd : 0) |
    (p.listens ? FLAG.events : 0) |
    (mesh.visible ? 0 : FLAG.hidden)
  );
}

/**
 * The bodies of a world, by slot: which mesh holds each, and what they count against the budget.
 * Adding and removing write commands; nothing reaches the worker before the frame's flush.
 */
export function createPhysicsBodies(
  writer: CommandWriter,
  budget: Readonly<PhysicsBudget>,
  host: PhysicsHost,
  root: Object3D,
  state: NonNullable<ObjectPhysics['_state']>,
) {
  const meshes: (Bodied | null)[] = [];
  const held: (Bodied['physics'] | null)[] = [];
  /** Each slot's generation, the high bits of its body's engine id (`BODY_INDEX`): moved on at
   *  every add and removal, so no record names a slot's next body or an empty slot. */
  const generation = new Uint8Array(budget.bodies);
  const free: number[] = [];
  const triangles = new Map<number, number>();
  const count = { bodies: 0, decorative: 0, triangles: 0 };
  /** Decorative bodies taken out once asleep: their mesh stays where it came to rest. */
  const retired = new WeakSet<Bodied['physics']>();
  const check = (key: keyof typeof count, more: number) => {
    const limit = budget[key];
    if (count[key] + more > limit) throw physicsBudgetError(key, limit, count[key] + more);
  };
  const add = (mesh: Bodied) => {
    const p = mesh.physics;
    if (p._host) return;
    if (p.type === 'dynamic' && mesh.parent !== root)
      throw new EngineError(
        'PHYSICS_NESTED',
        'A dynamic body must be a direct child of the scene: the simulation owns its world pose.',
        { name: mesh.name },
      );
    check('bodies', 1);
    if (p.decorative) check('decorative', 1);
    // The world pose as the transform tree composes it; the scale, axis by axis up the chain.
    const pose = worldPoseOf(mesh);
    const size = { x: 1, y: 1, z: 1 };
    for (let node: Object3D | null = mesh; node; node = node.parent) {
      size.x *= node.scale.x;
      size.y *= node.scale.y;
      size.z *= node.scale.z;
    }
    const shape = resolveShape(mesh.geometry, size, p.type, p.shape);
    const matter = physicsMatterOf(mesh.material);
    const id = claim(shape.triangles);
    const index = id & BODY_INDEX;
    writer.add({
      id,
      motion: MOTION[p.type],
      layer: p.type === 'static' ? LAYER.static : p.decorative ? LAYER.decorative : LAYER.moving,
      shape: shape.shape,
      flags: flagsOf(mesh),
      position: pose.position,
      quaternion: pose.quaternion,
      size: shape.size,
      mass: p.mass ?? 0,
      density: matter.density,
      friction: p.friction ?? matter.friction,
      restitution: p.restitution ?? matter.restitution,
      gravityScale: p.gravityScale,
      damping: [p.damping.linear, p.damping.angular],
      vertices: shape.vertices,
      indices: shape.indices,
      parts: shape.parts,
    });
    meshes[index] = mesh;
    held[index] = p;
    if (p.decorative) count.decorative++;
    p._attach(host, index, state);
  };
  /** A slot and its engine id, counted against the budget with `tris` triangles; no mesh yet. */
  const claim = (tris: number) => {
    check('bodies', 1);
    check('triangles', tris);
    const index = free.pop() ?? meshes.push(null) - 1;
    const next = (generation[index] = (generation[index] + 1) % GENERATIONS);
    count.bodies++;
    if (tris) triangles.set(index, tris);
    count.triangles += tris;
    return index | (next << GENERATION_SHIFT);
  };
  /** A slot's body removed, and the slot freed for the next. */
  const release = (index: number) => {
    writer.remove(index);
    meshes[index] = held[index] = null;
    generation[index] = (generation[index] + 1) % GENERATIONS;
    free.push(index);
    count.bodies--;
    count.triangles -= triangles.get(index) ?? 0;
    triangles.delete(index);
  };
  const removeAt = (index: number) => {
    const mesh = meshes[index],
      p = held[index];
    if (!mesh || !p) return;
    release(index);
    if (p.decorative) count.decorative--;
    p._detach();
  };
  /** The mesh an engine id names, or `null` once that body left its slot. */
  const meshOf = (id: number) => {
    const index = id & BODY_INDEX;
    return generation[index] === id >>> GENERATION_SHIFT ? (meshes[index] ?? null) : null;
  };
  return {
    meshes,
    generation,
    count,
    add,
    removeAt,
    meshOf,
    /** A body no mesh holds — a cooked tile (`tiles.ts`) —: its slot, then its removal. */
    claim,
    release,
    /** A decorative body fell asleep, or the module refused its shape: out of the simulation and
     *  of the budget, until its `physics` is set again. */
    retire(index: number) {
      const p = held[index];
      removeAt(index);
      if (p) retired.add(p);
    },
    /**
     * Brings the bodies in line with the scene, once per frame that changed it: a body whose mesh
     * left the scene, whose `physics` was replaced or whose shape or matter changed (`stale`) is
     * removed; every mesh under the scene with physics and no body gets one. A request past a
     * budget is refused and handed to `refused`, the other bodies proceed.
     */
    reconcile(stale: ReadonlySet<Object3D>, refused: (error: unknown) => void) {
      for (let i = 0; i < meshes.length; i++) {
        const mesh = meshes[i];
        if (mesh && (!mesh._link || mesh.physics !== held[i] || stale.has(mesh))) removeAt(i);
      }
      root.traverse((node) => {
        if (!hasBody(node) || node.physics._host || retired.has(node.physics)) return;
        try {
          add(node);
        } catch (error) {
          refused(error);
        }
      });
    },
    /** Every body the world holds, removed (physics turned off or the world disposed). */
    clear() {
      for (let i = 0; i < meshes.length; i++) removeAt(i);
    },
  };
}
