import { readFile } from 'node:fs/promises';
import {
  CommandWriter,
  DEFAULT_PHYSICS_BUDGET,
  type CookedBody,
  type PhysicsBudget,
  type PhysicsHost,
} from '../../../sdk-core/src/physics/index.ts';
import { Group, Object3D } from '../../../sdk-core/src/world/object/object3d.ts';
import { createPhysicsBodies } from './bodies.ts';
import { createPhysicsPoses } from './poses.ts';
import { createTileStreamer } from './tiles.ts';
import { JOLT_COMMIT } from '../../../sdk-core/src/physics/joltCommit.ts';

/** The bytes of `tests/fixtures/physics/<name>`. */
export const fixture = (name: string) =>
  readFile(new URL(`../../../../tests/fixtures/physics/${name}`, import.meta.url));
/** Node `node`'s body at `position`, declaring `motion` and `shape`, and `more` fields. */
export const declared = (
  node: number,
  position: number[],
  motion: object,
  shape: object,
  more = {},
) =>
  ({
    node,
    motion,
    shape,
    position,
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
    ...more,
  }) as CookedBody;

/** Lets the fetches in flight land: `streamedModel`'s fetch answers in microtasks alone, so the
 *  next turn of the event loop comes once every answer has been read. */
export const landed = () => new Promise(setImmediate);

/** A two-triangle tile at `x` along its collider. */
export const tile = (x = 0) => ({
  ...{ url: `t${x}.bin`, sha256: 'a'.repeat(64), bytes: 2, triangles: 2 },
  bounds: [x, 0, -1, x + 2, 1, 1],
});
/** Collider `collider` placed by its own node, ten metres apart, with the matter it declares. */
export const place = (collider: number, matter = {}) => ({
  ...{ node: collider, collider, position: [collider * 10, 0, 0] },
  ...{ rotation: [0, 0, 0, 1], scale: [1, 1, 1], ...matter },
});
/** A `physics.json` of `colliders` placed by `instances`, and `softBodies`. */
export const cooked = (colliders: object[], instances: object[], softBodies: object[] = []) => ({
  ...{ formatVersion: 2, jolt: JOLT_COMMIT, colliders, instances, softBodies },
});

/** The files of a compiled model: `physics.json` answered with `file`, any other with `bytes`. */
export const modelFiles = (file: object, bytes: Uint8Array) => (url: string) =>
  new Response(url.endsWith('physics.json') ? JSON.stringify(file) : bytes.slice());

/** Answers every fetch from now on with `modelFiles`; the names of the files fetched. */
export function stubFetch(file: object, bytes: Uint8Array) {
  const fetched: string[] = [];
  const serve = modelFiles(file, bytes);
  globalThis.fetch = (async (url: string) => {
    fetched.push(url.split('/').pop()!);
    return serve(url);
  }) as typeof fetch;
  return fetched;
}

/** A compiled model at the origin, as `world.scene.load` places one. Given the bodies it
 *  `declared`, it numbers its nodes as its source does (`_nodeAt`): each body's node a child of
 *  it, posed as declared, alone in its subtree, of radius 1. */
export function compiledModel(declared: readonly CookedBody[] = []) {
  const nodes: Object3D[] = [];
  const nodeAt = (index: number) =>
    nodes[index] ? { node: nodes[index], indices: [index], radius: 1 } : null;
  const model = Object.assign(new Object3D(), {
    isLoadedModel: true as const,
    record: { base: 'https://cache.test/model/' },
    _nodeAt: declared.length ? nodeAt : undefined,
  });
  for (const { node, position, rotation } of declared) {
    nodes[node] = new Object3D();
    nodes[node].position.set(...position);
    nodes[node].quaternion.set(...rotation);
    model.add(nodes[node]);
  }
  return model;
}

/**
 * A tile streamer within `budget` (8 bodies) over a scene holding one compiled model at the
 * origin, scaled by `scale`, numbering the nodes of the bodies it `declared` (`compiledModel`), not
 * scanned yet: the streamer, the scene, the model, the writer, the bodies, the errors raised, and
 * `heard`, which settles at the next change or error it reports.
 */
export function modelStreamer(
  budget: Partial<PhysicsBudget> = {},
  scale = 1,
  declared: readonly CookedBody[] = [],
) {
  const limits = { ...DEFAULT_PHYSICS_BUDGET, bodies: 8, ...budget };
  const [scene, writer, errors] = [new Group(), new CommandWriter(), [] as { code: string }[]];
  const { state } = createPhysicsPoses(limits.bodies, scene);
  const bodies = createPhysicsBodies(writer, limits, {} as PhysicsHost, scene, state);
  let wake = () => {};
  const heard = () => new Promise<void>((resolve) => (wake = resolve));
  const tiles = createTileStreamer(
    writer,
    limits,
    bodies,
    () => wake(),
    (e) => (errors.push(e), wake()),
  );
  const model = compiledModel(declared);
  model.scale.setScalar(scale);
  model.updateMatrixWorld(true);
  scene.add(model);
  return { tiles, scene, model, writer, bodies, errors, heard };
}

/**
 * A model at the origin, scaled by `scale`, numbering the nodes of the bodies it `declared`,
 * whose `physics.json` is `file` and every other file `bytes`, opened by a tile streamer within
 * `budget` (8 bodies): the streamer, the scene, the model, the writer, the bodies, the errors
 * raised and the files fetched.
 */
export async function streamedModel(
  file: object,
  bytes: Uint8Array,
  budget: Partial<PhysicsBudget> = {},
  scale = 1,
  declared: readonly CookedBody[] = [],
) {
  const fetched = stubFetch(file, bytes);
  const streamer = modelStreamer(budget, scale, declared);
  streamer.tiles.scan(streamer.scene);
  await landed();
  return { ...streamer, fetched };
}
