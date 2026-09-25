import {
  CommandWriter,
  DEFAULT_PHYSICS_BUDGET,
  type PhysicsBudget,
  type PhysicsHost,
} from '../../../sdk-core/src/physics/index.ts';
import { Group, Object3D } from '../../../sdk-core/src/world/object/object3d.ts';
import { createPhysicsBodies } from './bodies.ts';
import { createPhysicsPoses } from './poses.ts';
import { createTileStreamer } from './tiles.ts';

/** Lets the fetches in flight land: `streamedModel`'s fetch answers in microtasks alone, so the
 *  next turn of the event loop comes once every answer has been read. */
export const landed = () => new Promise(setImmediate);

/**
 * A model at the origin, scaled by `scale`, whose `physics.json` is `file` and every other file
 * `bytes`, opened by a tile streamer within `budget` (8 bodies): the streamer, the scene, the model,
 * the writer, the bodies, the errors raised and the files fetched.
 */
export async function streamedModel(
  file: object,
  bytes: Uint8Array,
  budget: Partial<PhysicsBudget> = {},
  scale = 1,
) {
  const fetched: string[] = [];
  globalThis.fetch = (async (url: string) => {
    fetched.push(url.split('/').pop()!);
    const json = async () => JSON.parse(JSON.stringify(file));
    return { ok: true, json, arrayBuffer: async () => bytes.slice().buffer };
  }) as unknown as typeof fetch;
  const limits = { ...DEFAULT_PHYSICS_BUDGET, bodies: 8, ...budget };
  const [scene, writer, errors] = [new Group(), new CommandWriter(), [] as { code: string }[]];
  const { state } = createPhysicsPoses(limits.bodies, scene);
  const bodies = createPhysicsBodies(writer, limits, {} as PhysicsHost, scene, state);
  const tiles = createTileStreamer(
    writer,
    limits,
    bodies,
    () => {},
    (e) => errors.push(e),
  );
  const model = Object.assign(new Object3D(), {
    isLoadedModel: true as const,
    record: { base: 'https://cache.test/model/' },
  });
  model.scale.setScalar(scale);
  model.updateMatrixWorld(true);
  scene.add(model);
  tiles.scan(scene);
  await landed();
  return { tiles, scene, model, writer, bodies, errors, fetched };
}
