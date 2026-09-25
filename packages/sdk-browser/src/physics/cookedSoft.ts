import { EngineError } from '../../../sdk-core/src/contracts/cache.ts';
import {
  BODY_INDEX,
  ObjectPhysics,
  physicsMatterOf,
  type CommandWriter,
  type CookedSoftBody,
} from '../../../sdk-core/src/physics/index.ts';
import type { createPhysicsBodies } from './bodies.ts';
import { writeSoftBody } from './softBodies.ts';
import { cookedBytes, tilePose, type Model } from './tilePlace.ts';

/** How far, relatively, a model's scale may stray from the one its soft bodies were cooked at. */
const SCALE_TOLERANCE = 1e-4;

/**
 * The cooked soft bodies of the compiled models in a scene (`physics.json` `softBodies`): each
 * one's settings fetched and handed to the simulation as Jolt restores them — a decode and a
 * copy, nothing built on the page — at its node's place in its model, within
 * `budget.physics.softVertices`. Its matter, pull and damping are the options its node declares,
 * read as `obj.physics` reads them. Jolt scales no soft body once made: a model placed at another
 * scale than the one it was cooked at has its soft bodies refused, by name.
 */
export function createCookedSoftBodies(
  writer: CommandWriter,
  bodies: Pick<ReturnType<typeof createPhysicsBodies>, 'claim' | 'release'>,
  invalidate: () => void,
  failed: (error: EngineError) => void,
) {
  /** The slots of each open model's soft bodies, and the model of each slot. */
  const held = new Map<Model, number[]>();
  const owners = new Map<number, Model>();
  /** `soft`'s world pose in `model` (scratch), refused when the model is placed at another scale
   *  than the one it was cooked at. */
  function poseOf(model: Model, soft: CookedSoftBody) {
    const pose = tilePose({ model, instance: soft });
    const { scale } = pose,
      at = soft.scale;
    if (
      [scale.x, scale.y, scale.z].some(
        (s, k) => Math.abs(s - at[k]) > SCALE_TOLERANCE * Math.abs(at[k]),
      )
    )
      throw new EngineError(
        'PHYSICS_FAILED',
        `The soft body of node ${soft.node} was cooked at scale ${at.join(', ')}: its model is placed at another.`,
        { node: soft.node },
      );
    return pose;
  }
  async function add(model: Model, slots: number[], soft: CookedSoftBody) {
    // Refused before its bytes are fetched: a scale is read from the model alone.
    poseOf(model, soft);
    const cooked = await cookedBytes(model, soft.settings.url, 'Soft body settings');
    // Forgotten, or opened again, meanwhile: this opening's bodies are no longer wanted.
    if (held.get(model) !== slots) return;
    // Posed again once fetched: the model may have moved or been rescaled meanwhile.
    const { position, quaternion } = poseOf(model, soft);
    const p = new ObjectPhysics(soft.physics);
    const id = bodies.claim(0, soft.vertices);
    // Held at once: a throw below still leaves the slot for `forget` to release.
    slots.push(id & BODY_INDEX);
    owners.set(id & BODY_INDEX, model);
    // The collider's matter picked: `physics`, the options, is no preset name here.
    const matter = physicsMatterOf({ friction: soft.friction, restitution: soft.restitution });
    const record = { cooked, pressure: soft.pressure };
    const pose = { position, quaternion, scale: soft.scale };
    writeSoftBody(writer, id, p, matter, pose, record);
    invalidate();
  }
  const forget = (model: Model) => {
    for (const slot of held.get(model) ?? []) {
      bodies.release(slot);
      owners.delete(slot);
    }
    held.delete(model);
  };
  return {
    /** Makes the soft bodies `model` was cooked with. */
    open(model: Model, softBodies: readonly CookedSoftBody[] = []) {
      // Opened again: the bodies of the last opening out, none held twice.
      forget(model);
      const slots: number[] = [];
      held.set(model, slots);
      for (const soft of softBodies)
        add(model, slots, soft).catch((error) => failed(error as EngineError));
    },
    /** A model left the scene, or physics turned off: its soft bodies out. */
    forget,
    /** The model a cooked soft body's engine id belongs to, or `null`: what a ray on it hits. */
    modelOf: (id: number) => owners.get(id & BODY_INDEX) ?? null,
  };
}
