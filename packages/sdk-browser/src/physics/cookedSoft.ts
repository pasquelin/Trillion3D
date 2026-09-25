import { EngineError } from '../../../sdk-core/src/contracts/cache.ts';
import {
  BODY_INDEX,
  ObjectPhysics,
  physicsMatterOf,
  writeSoft,
  type CommandWriter,
  type CookedSoftBody,
} from '../../../sdk-core/src/physics/index.ts';
import type { createPhysicsBodies } from './bodies.ts';
import { tilePose, type Model } from './tilePlace.ts';

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
  /** The slots of each open model's soft bodies. */
  const held = new Map<Model, number[]>();
  async function add(model: Model, soft: CookedSoftBody) {
    const response = await fetch(new URL(soft.settings.url, model.record.base).href);
    if (!response.ok)
      throw new EngineError(
        'PHYSICS_FAILED',
        `Soft body settings ${soft.settings.url}: ${response.status}.`,
      );
    const cooked = new Uint8Array(await response.arrayBuffer());
    const slots = held.get(model);
    if (!slots) return;
    const { position, quaternion, scale } = tilePose({ model, instance: soft });
    const at = soft.scale;
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
    const p = new ObjectPhysics(soft.physics);
    const matter = physicsMatterOf({ friction: soft.friction, restitution: soft.restitution });
    const id = bodies.claim(0, soft.vertices);
    writeSoft(writer, {
      ...{ id, position, quaternion, scale: at },
      ...{
        friction: p.friction ?? matter.friction,
        restitution: p.restitution ?? matter.restitution,
      },
      ...{ gravityScale: p.gravityScale, linearDamping: p.damping.linear },
      ...{ settings: p.soft!, record: { cooked, pressure: soft.pressure } },
    });
    slots.push(id & BODY_INDEX);
    invalidate();
  }
  const forget = (model: Model) => {
    for (const slot of held.get(model) ?? []) bodies.release(slot);
    held.delete(model);
  };
  return {
    /** Makes the soft bodies `model` was cooked with. */
    open(model: Model, softBodies: readonly CookedSoftBody[] = []) {
      held.set(model, []);
      for (const soft of softBodies)
        add(model, soft).catch((error) => failed(error as EngineError));
    },
    /** A model left the scene: its soft bodies out. */
    forget,
    /** Every soft body out (physics turned off). */
    clear() {
      for (const model of [...held.keys()]) forget(model);
    },
  };
}
