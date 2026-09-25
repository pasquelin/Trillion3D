import { EngineError } from '../../../sdk-core/src/contracts/cache.ts';
import {
  BODY_INDEX,
  ObjectPhysics,
  physicsMatterOf,
  type CommandWriter,
  type CookedSoftBody,
} from '../../../sdk-core/src/physics/index.ts';
import { flagsOf, type createPhysicsBodies } from './bodies.ts';
import { writeSoftBody } from './softBodies.ts';
import { cookedBytes, tilePose, type Model } from './tilePlace.ts';

/** How far, relatively, a model's scale may stray from the one its soft bodies were cooked at. */
const SCALE_TOLERANCE = 1e-4;
const near = (s: number, at: number) => Math.abs(s - at) <= SCALE_TOLERANCE * Math.abs(at);
/** Whether `scale`, a soft body's world scale, is `at`, the one it was cooked at. */
const fits = (scale: { x: number; y: number; z: number }, at: CookedSoftBody['scale']) =>
  near(scale.x, at[0]) && near(scale.y, at[1]) && near(scale.z, at[2]);

/**
 * The cooked soft bodies of the compiled models in a scene (`physics.json` `softBodies`): each
 * one's settings fetched and handed to the simulation as Jolt restores them — a decode and a
 * copy, nothing built on the page — at its node's place in its model, within
 * `budget.physics.softVertices`. Its matter, pull and damping are the options its node declares,
 * read as `obj.physics` reads them, and its flags those a page-built one takes (`flagsOf`), its
 * model's visibility for its own. Jolt scales no soft body once made: a model placed at another
 * scale than the one it was cooked at has its soft bodies refused, by name.
 */
export function createCookedSoftBodies(
  writer: CommandWriter,
  bodies: Pick<ReturnType<typeof createPhysicsBodies>, 'claim' | 'release'>,
  invalidate: () => void,
  failed: (error: EngineError) => void,
) {
  /** A soft body made: its entry, its options, its slot. */
  type Made = { soft: CookedSoftBody; physics: ObjectPhysics; slot: number };
  /** Each open model's opening: its soft bodies made, and those refused at another scale. */
  type Opening = { made: Made[]; refused: CookedSoftBody[] };
  const held = new Map<Model, Opening>();
  /** Each soft body's settings, fetched once: a model opened again restores its bodies from them,
   *  never waiting on the network. */
  const settings = new WeakMap<CookedSoftBody, Promise<Uint8Array>>();
  function settingsOf(model: Model, soft: CookedSoftBody) {
    let bytes = settings.get(soft);
    if (!bytes)
      settings.set(soft, (bytes = cookedBytes(model, soft.settings.url, 'Soft body settings')));
    return bytes;
  }
  /** Lists `soft` refused in `opening`, and refuses it by name: at another scale than it was
   *  cooked at. */
  function refuse(opening: Opening, soft: CookedSoftBody) {
    opening.refused.push(soft);
    failed(
      new EngineError(
        'PHYSICS_FAILED',
        `The soft body of node ${soft.node} was cooked at scale ${soft.scale.join(', ')}: its model is placed at another.`,
        { node: soft.node },
      ),
    );
  }
  async function add(model: Model, opening: Opening, soft: CookedSoftBody) {
    const cooked = await settingsOf(model, soft);
    // Forgotten or opened again meanwhile: this opening's bodies are no longer wanted.
    if (held.get(model) !== opening) return;
    const { position, quaternion, scale } = tilePose({ model, instance: soft });
    if (!fits(scale, soft.scale)) return refuse(opening, soft);
    const p = new ObjectPhysics(soft.physics);
    const id = bodies.claim(0, soft.vertices);
    // Held at once: a throw below still leaves the slot for `forget` to release.
    opening.made.push({ soft, physics: p, slot: id & BODY_INDEX });
    // The collider's matter picked: `physics`, the options, is no preset name here.
    const matter = physicsMatterOf({ friction: soft.friction, restitution: soft.restitution });
    const record = { cooked, pressure: soft.pressure };
    const pose = { position, quaternion, scale: soft.scale };
    const flags = flagsOf({ physics: p, visible: model.visible });
    writeSoftBody(writer, id, p, matter, pose, record, flags);
    invalidate();
  }
  /** Restores `soft` in `opening`, a failure reported. */
  const start = (model: Model, opening: Opening, soft: CookedSoftBody) =>
    void add(model, opening, soft).catch((error) => failed(error as EngineError));
  const forget = (model: Model) => {
    held.get(model)?.made.forEach(({ slot }) => bodies.release(slot));
    held.delete(model);
  };
  /** Makes the soft bodies `model` was cooked with, the last opening's out: none held twice. */
  function open(model: Model, softBodies: readonly CookedSoftBody[] = []) {
    forget(model);
    const opening: Opening = { made: [], refused: [] };
    held.set(model, opening);
    for (const soft of softBodies) start(model, opening, soft);
  }
  return {
    open,
    /** A model left the scene, or physics turned off: its soft bodies out. */
    forget,
    /** A model moved or hidden: its soft bodies carried where it now is, their simulation kept,
     *  their flags written again; one rescaled is released and refused by name — Jolt scales no
     *  soft body once made —, and made again once back at its scale. */
    moved(model: Model) {
      const opening = held.get(model);
      if (!opening) return;
      // Back at its scale, a refused body is made again.
      if (opening.refused.length) {
        const refused = opening.refused;
        opening.refused = [];
        for (const soft of refused)
          if (fits(tilePose({ model, instance: soft }).scale, soft.scale))
            start(model, opening, soft);
          else opening.refused.push(soft);
      }
      // Compacted in place: a model moved every frame makes no new list.
      const { made } = opening;
      let kept = 0;
      for (const body of made) {
        const { position, quaternion, scale } = tilePose({ model, instance: body.soft });
        if (!fits(scale, body.soft.scale)) {
          bodies.release(body.slot);
          refuse(opening, body.soft);
          continue;
        }
        writer.teleport(body.slot, position, quaternion);
        writer.flags(body.slot, flagsOf({ physics: body.physics, visible: model.visible }));
        made[kept++] = body;
      }
      made.length = kept;
    },
    /** The model a cooked soft body's engine id belongs to, or `null`: what a ray on it hits. */
    modelOf(id: number) {
      for (const [model, { made }] of held)
        if (made.some(({ slot }) => slot === (id & BODY_INDEX))) return model;
      return null;
    },
  };
}
