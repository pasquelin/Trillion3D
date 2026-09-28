import type { EngineError } from '../../../sdk-core/src/contracts/cache.ts';
import {
  BODY_INDEX,
  FLAG,
  LAYER,
  MOTION,
  declaredMass,
  declaredShape,
  physicsMatterOf,
  type CommandWriter,
  type CookedBody,
  TRIANGLE_BYTES,
} from '../../../sdk-core/src/physics/index.ts';
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';
import { resolveCameraWorld } from '../camera/world.ts';
import type { createPhysicsBodies } from './bodies.ts';
import { worldPoseOf } from './bodyFrame.ts';
import { fits } from './softBodies.ts';
import { cookedBytes, tilePose, type Model, type ModelNode } from './tilePlace.ts';

/** The scene node a dynamic body's poses move, how far around it it wants ground, and the world
 *  scale its body was made at: what the poses and the tiles read (`bodySlots.ts`). */
export type NodeMove = { node: Object3D; reach: number; scale: readonly number[] };
/** A declared body made: its entry, its hull's bytes, the world scale it was made at, its id,
 *  and — a dynamic one — the node it moves. */
export type CookedMadeBody = {
  body: CookedBody;
  bytes?: Uint8Array;
  scale: number[];
  id: number;
  moves: NodeMove | null;
};

/**
 * The rigid bodies the compiled models in a scene declare (`physics.json` `bodies`), each one a
 * body of its model's (`bodySlots.ts`): its declared shape in Jolt's terms, or its cooked hull
 * fetched and restored — nothing built on the page —, with its declared mass over its cooked one
 * (`declaredMass`), counted against `budget.physics`. A kinematic body follows its model as any
 * kinematic body. A dynamic one simulates, and its poses move its node (`poses.ts`), which loads
 * tiles as a mover (`moversOf`); held kinematic where its node is drawn when its model numbers
 * its nodes otherwise than the source (`Model._nodeAt`). A body made, its node's static instances
 * leave (`holds`) — a dynamic one's whole subtree's, which moves with it —: no collider is doubled.
 */
export function createCookedBodies(
  writer: CommandWriter,
  bodies: Pick<ReturnType<typeof createPhysicsBodies>, 'claim' | 'release'>,
  invalidate: () => void,
  failed: (error: EngineError) => void,
) {
  /** Each open model's opening: its bodies made, the nodes whose body is made or on its way —
   *  their static tiles unwanted —, each dynamic body's node, each hull read once by URL (bodies
   *  drawing one mesh share it), and the signal its leaving aborts its reads by. */
  type Opening = {
    made: CookedMadeBody[];
    nodes: Set<number>;
    moving: Map<CookedBody, ModelNode>;
    hulls: Map<string, Promise<Uint8Array>>;
    signal: AbortSignal;
  };
  const held = new Map<Model, Opening>();
  /** The nodes whose static tiles `body` stands for: a dynamic one's subtree, else its node. */
  const unwanted = (opening: Opening, body: CookedBody) =>
    opening.moving.get(body)?.indices ?? [body.node];
  /** `body` made where its model places it now — a dynamic one where its node is drawn —, from
   *  its hull's `bytes`; throws, nothing held, for a shape the scale bends or a body past the
   *  budget. */
  function make(model: Model, opening: Opening, body: CookedBody, bytes?: Uint8Array) {
    const placed = tilePose({ model, instance: body });
    const { scale } = placed;
    const resolved = declaredShape(body, scale);
    const at = opening.moving.get(body);
    const size = [scale.x, scale.y, scale.z];
    // Its radius is in its parent's frame: scaled by that parent's world scale.
    const parent = at && resolveCameraWorld(at.node.parent ?? model).matrixWorld;
    const moves = at
      ? { node: at.node, reach: at.radius * parent!.getMaxScaleOnAxis(), scale: size }
      : null;
    const { position, quaternion } = at ? worldPoseOf(at.node) : placed;
    const made: CookedMadeBody = { body, bytes, scale: size, id: -1, moves };
    made.id = bodies.claim(resolved.triangles * TRIANGLE_BYTES, 0, { model, body: made });
    const handle = made.id & BODY_INDEX;
    const matter = physicsMatterOf(body);
    const moving = !!moves;
    if (bytes) writer.restore(handle, bytes);
    writer.add({
      ...{ id: made.id, motion: moving ? MOTION.dynamic : MOTION.kinematic },
      ...{ layer: LAYER.moving, shape: resolved.shape, position, quaternion },
      // Held or kinematic, it is added asleep: it stands still until its model moves it.
      flags: moving ? 0 : FLAG.asleep,
      ...{ size: resolved.size, ...declaredMass(body, scale), density: matter.density },
      ...{ friction: matter.friction, restitution: matter.restitution },
      ...{ gravityScale: body.motion.gravityFactor ?? 1, indices: bytes && [handle] },
    });
    if (bytes) writer.release(handle);
    invalidate();
    return made;
  }
  async function add(model: Model, opening: Opening, body: CookedBody) {
    const { shape } = body,
      { hulls, signal } = opening;
    const url = shape.type === 'cooked' ? shape.url : '';
    if (url && !hulls.has(url)) hulls.set(url, cookedBytes(model, url, signal));
    const bytes = url ? await hulls.get(url) : undefined;
    // Forgotten or opened again meanwhile: this opening's bodies are no longer wanted.
    if (held.get(model) === opening) opening.made.push(make(model, opening, body, bytes));
  }
  /** `body` refused — but for a read its model let go of —: reported, its nodes static ground
   *  again. */
  const refuse = (opening: Opening, body: CookedBody, error: unknown) => {
    if (opening.signal.aborted) return;
    for (const node of unwanted(opening, body)) opening.nodes.delete(node);
    failed(error as EngineError);
  };
  const start = (model: Model, opening: Opening, body: CookedBody) =>
    void add(model, opening, body).catch((error) => refuse(opening, body, error));
  const forget = (model: Model) => {
    const opening = held.get(model);
    held.delete(model);
    opening?.made.forEach(({ id }) => bodies.release(id & BODY_INDEX));
  };
  return {
    /** Makes the bodies `model` declares, read until `signal` aborts, the last opening's out. */
    open(model: Model, declared: readonly CookedBody[], signal: AbortSignal) {
      forget(model);
      const opening: Opening = {
        made: [],
        nodes: new Set(),
        moving: new Map(),
        hulls: new Map(),
        signal,
      };
      for (const body of declared) {
        const at = body.motion.isKinematic ? null : model._nodeAt?.(body.node);
        if (at) opening.moving.set(body, at);
        unwanted(opening, body).forEach((node) => opening.nodes.add(node));
      }
      held.set(model, opening);
      for (const body of declared) start(model, opening, body);
    },
    /** A model left the scene, or physics turned off: its bodies out. */
    forget,
    /** Whether node `node` of `model` has its body, made or on its way: its tiles then leave. */
    holds: (model: Model, node: number) => held.get(model)?.nodes.has(node) ?? false,
    /** A model moved: its bodies follow — a kinematic one driven there, pushing what it meets, a
     *  dynamic one put where its node is now drawn —; one rescaled is made again at once at its
     *  new scale, Jolt scaling no body once made. The list is compacted in place: a model moved
     *  every frame makes no new one. */
    moved(model: Model) {
      const opening = held.get(model);
      if (!opening) return;
      const { made } = opening;
      let kept = 0;
      for (const one of made) {
        const { position, quaternion, scale } = tilePose({ model, instance: one.body });
        const slot = one.id & BODY_INDEX;
        if (!fits(scale, one.scale)) {
          bodies.release(slot);
          try {
            made[kept] = make(model, opening, one.body, one.bytes);
            kept++;
          } catch (error) {
            refuse(opening, one.body, error);
          }
          continue;
        }
        if (one.moves) {
          const now = worldPoseOf(one.moves.node);
          writer.teleport(slot, now.position, now.quaternion);
        } else writer.moveKinematic(slot, position, quaternion);
        made[kept++] = one;
      }
      made.length = kept;
    },
    /** The worker refused `body`'s shape: out, its node static ground again, until its model
     *  opens again. */
    refused({ model, body }: { model: Model; body: CookedMadeBody }) {
      const opening = held.get(model);
      const at = opening?.made.indexOf(body) ?? -1;
      if (at < 0) return;
      opening!.made.splice(at, 1);
      for (const node of unwanted(opening!, body.body)) opening!.nodes.delete(node);
      bodies.release(body.id & BODY_INDEX);
    },
  };
}
