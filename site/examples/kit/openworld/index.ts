/**
 * The open world's play layer, served as `runtime/openworld.js`: walking, driving and flying
 * over the world with Jolt physics, in a worker (`runtime/openworldSim.js`) that loads Jolt
 * (`runtime/jolt-physics.wasm.js` and its `.wasm`) on demand. It never imports the engine: the
 * page passes its families in.
 *
 * ```js
 * const play = createPlay({ world, engine: { geometry, material, object, light }, data, heights: '…/heights/{tx}_{tz}.bin' });
 * await play.ready;
 * ```
 */
export { createPlay, type Play } from './play/play.ts';
export { DEFAULT_MODELS } from './play/specs.ts';
export type { ColliderInstance, CollisionMesh } from './play/collision.ts';
export type {
  Engine,
  Mode,
  ModelPart,
  ModelSpec,
  PlayOptions,
  PlayWorld,
  Wheel,
} from './play/types.ts';
export * from './sky/index.ts';
