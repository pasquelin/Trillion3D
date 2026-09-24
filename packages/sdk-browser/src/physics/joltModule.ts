import { EVENT_WORDS, MODULE_ERROR, POSE_WORDS } from '../../../sdk-core/src/physics/index.ts';
import { joltImports, type SpawnJoltThread } from './joltThreads.ts';
import { MAX_EVENTS } from './protocol.ts';

/** The flat C API of `joltPhysics.wasm` (`packages/physics-jolt-wasm/src/world.cpp`). */
interface JoltExports {
  _initialize(): void;
  jolt_init(maxBodies: number, tempBytes: number, threads: number): number;
  jolt_buffer(which: number, words: number): number;
  jolt_step(commandWords: number, dt: number, substeps: number): number;
  jolt_event_count(): number;
  jolt_error(): number;
  jolt_active_count(): number;
}

/** Bytes of Jolt's per-step scratch allocator, taken from the memory budget. */
const TEMP_BYTES = 16 * 1024 * 1024;
const PAGE = 65536;
/** Pages the module declares as its initial memory (`-sINITIAL_MEMORY`, CMakeLists.txt). */
const INITIAL_PAGES = 512;

/** One running physics module: its memory views and its three buffers. */
export interface JoltModule {
  /** Copies `words` into the command buffer, runs them, steps `dt` seconds; returns the pose count. */
  step(words: Uint32Array | null, dt: number): number;
  /** The module's pose words, valid until the next step. */
  poses(count: number): Uint32Array;
  /** The module's event words for the last step. */
  events(): Uint32Array;
  active(): number;
  /** Whether the memory has grown to its budget: a trap then is the budget, not a fault. */
  full(): boolean;
  /** The module's raw exports and memory, for tools (the bench reads a profiled build's totals). */
  exports: WebAssembly.Exports;
  memory: WebAssembly.Memory;
}

/**
 * Instantiates the physics module in a memory whose maximum is the budget: the module cannot grow
 * past `memoryBytes`, and a step that would needs more fails (`PHYSICS_BUDGET`). No emscripten glue:
 * the module imports its memory, a growth notice and a clock, all given here. With `threads`, the
 * bytes are the threaded module's: its memory is shared, and `threads.count` threads step it, this
 * one included, the others started through `threads.spawn` (`joltThreads.ts`).
 */
export async function instantiateJolt(
  bytes: BufferSource,
  maxBodies: number,
  memoryBytes: number,
  threads: { count: number; spawn: SpawnJoltThread } | null,
): Promise<JoltModule> {
  const maximum = Math.floor(memoryBytes / PAGE);
  if (maximum < INITIAL_PAGES)
    throw new Error(`PHYSICS_BUDGET: memoryBytes below the module's ${INITIAL_PAGES * PAGE} bytes`);
  const shared = threads !== null;
  const memory = new WebAssembly.Memory({ initial: INITIAL_PAGES, maximum, shared });
  const module = await WebAssembly.compile(bytes);
  let exports: unknown = null;
  const pool = threads && { module, ...threads };
  const imports = joltImports(memory, () => exports as never, pool);
  const instance = await WebAssembly.instantiate(module, imports);
  exports = instance.exports;
  const jolt = instance.exports as unknown as JoltExports;
  jolt._initialize();
  if (jolt.jolt_init(maxBodies, TEMP_BYTES, threads?.count ?? 1) !== 0)
    throw new Error('PHYSICS_FAILED: init');
  let commandWords = 1024;
  let commands = jolt.jolt_buffer(0, commandWords);
  const poseWords = maxBodies * POSE_WORDS;
  const poses = jolt.jolt_buffer(1, poseWords);
  const events = jolt.jolt_buffer(2, MAX_EVENTS * EVENT_WORDS);
  if (!commands || !poses || !events) throw new Error('PHYSICS_BUDGET: memoryBytes');
  return {
    step(words, dt) {
      const count = words?.length ?? 0;
      if (count > commandWords) {
        commands = jolt.jolt_buffer(0, count);
        if (!commands) throw new Error('PHYSICS_BUDGET: memoryBytes');
        commandWords = count;
      }
      if (words) new Uint32Array(memory.buffer, commands, count).set(words);
      const posed = jolt.jolt_step(count, dt, 1);
      if (posed === 0xffffffff)
        throw new Error(`PHYSICS_FAILED: ${MODULE_ERROR[jolt.jolt_error()] ?? 'unknown'}`);
      return posed;
    },
    poses: (count) => new Uint32Array(memory.buffer, poses, count * POSE_WORDS),
    events: () => new Uint32Array(memory.buffer, events, jolt.jolt_event_count() * EVENT_WORDS),
    active: () => jolt.jolt_active_count(),
    full: () => memory.buffer.byteLength + 4 * PAGE > maximum * PAGE,
    exports: instance.exports,
    memory,
  };
}
