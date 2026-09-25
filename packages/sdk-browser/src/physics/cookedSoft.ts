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

/** An open model's opening: its soft bodies, and those made, by engine id. */
interface Opening {
  softBodies: readonly CookedSoftBody[];
  made: Map<number, CookedSoftBody>;
}

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
  const held = new Map<Model, Opening>();
  /** Soft bodies the worker refused: not made again until their model opens again. */
  const refused = new WeakSet<CookedSoftBody>();
  /** Each soft body's settings, fetched once: a model moved frame after frame makes its bodies
   *  again from them within the frame, never waiting on the network. */
  const settings = new WeakMap<CookedSoftBody, Promise<Uint8Array>>();
  function settingsOf(model: Model, soft: CookedSoftBody) {
    let bytes = settings.get(soft);
    if (!bytes)
      settings.set(soft, (bytes = cookedBytes(model, soft.settings.url, 'Soft body settings')));
    return bytes;
  }
  /** `soft`'s world pose in `model` (scratch), refused when the model is placed at another scale
   *  than the one it was cooked at. */
  function poseOf(model: Model, soft: CookedSoftBody) {
    const pose = tilePose({ model, instance: soft });
    const at = soft.scale;
    if (
      pose.scale.toArray().some((s, k) => Math.abs(s - at[k]) > SCALE_TOLERANCE * Math.abs(at[k]))
    )
      throw new EngineError(
        'PHYSICS_FAILED',
        `The soft body of node ${soft.node} was cooked at scale ${at.join(', ')}: its model is placed at another.`,
        { node: soft.node },
      );
    return pose;
  }
  async function add(model: Model, opening: Opening, soft: CookedSoftBody) {
    const cooked = await settingsOf(model, soft);
    // Forgotten, opened again or moved meanwhile: this opening's bodies are no longer wanted.
    if (held.get(model) !== opening || refused.has(soft)) return;
    const { position, quaternion } = poseOf(model, soft);
    const p = new ObjectPhysics(soft.physics);
    const id = bodies.claim(0, soft.vertices);
    // Held at once: a throw below still leaves the slot for `forget` to release.
    opening.made.set(id, soft);
    // The collider's matter picked: `physics`, the options, is no preset name here.
    const matter = physicsMatterOf({ friction: soft.friction, restitution: soft.restitution });
    const record = { cooked, pressure: soft.pressure };
    const pose = { position, quaternion, scale: soft.scale };
    writeSoftBody(writer, id, p, matter, pose, record);
    invalidate();
  }
  const forget = (model: Model) => {
    for (const id of held.get(model)?.made.keys() ?? []) bodies.release(id & BODY_INDEX);
    held.delete(model);
  };
  /** Makes the soft bodies `model` was cooked with, the last opening's out: none held twice. */
  function open(model: Model, softBodies: readonly CookedSoftBody[] = []) {
    forget(model);
    const opening = { softBodies, made: new Map<number, CookedSoftBody>() };
    held.set(model, opening);
    for (const soft of softBodies)
      add(model, opening, soft).catch((error) => failed(error as EngineError));
  }
  return {
    open,
    /** A model left the scene, or physics turned off: its soft bodies out. */
    forget,
    /** A model moved: its soft bodies made again where it now is, as a page-built one is, and
     *  refused by name when it was rescaled — Jolt scales no soft body once made. */
    moved(model: Model) {
      const softBodies = held.get(model)?.softBodies;
      if (softBodies?.length) open(model, softBodies);
    },
    /** The model a cooked soft body's engine id belongs to, or `null`: what a ray on it hits. */
    modelOf(id: number) {
      for (const [model, { made }] of held) if (made.has(id)) return model;
      return null;
    },
    /** The worker refused soft body `id`: its slot and budget given back; any other id ignored. */
    refused(id: number) {
      for (const { made } of held.values()) {
        const soft = made.get(id);
        if (!soft) continue;
        made.delete(id);
        bodies.release(id & BODY_INDEX);
        return void refused.add(soft);
      }
    },
  };
}
