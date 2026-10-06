/**
 * The physics worker: it loads the physics module and takes the fixed steps the page's frames owe it
 * (`advance`, `stepClock.ts`), handing their poses and contact events back in a transferable
 * buffer. No clock of its own counts a step: the page's messages run in the order it sent them —
 * commands, keys, character, water, steps —, so the same frames and inputs take the same steps on
 * the same inputs, whatever this worker's speed; an advance of no step, the page's clock standing
 * still, runs the commands sent before it in place. Two buffers go back and forth, and the steps
 * write straight into a free one; when the page still holds both, the results wait in a staging
 * copy, and once one more step's events might not fit there, that step and every message after it
 * wait, in order, for the next buffer. With every body asleep, no command queued, no leave owed and
 * the character still, the world rests: an advance takes no step (the waves run on by the page's
 * step alone, `water.ts`), and the page, told so, sends no more until something wakes it.
 */
import { EngineError } from '../../../sdk-core/src/contracts/cache.ts';
import { PHYSICS_STEP } from '../../../sdk-core/src/physics/index.ts';
import { checked } from '../cluster/checked.ts';
import { openJolt, startJolt, type JoltModule } from './joltModule.ts';
import { JOLT_THREAD_LOADED, joltWorkerPool, runJoltThread } from './joltThreads.ts';
import { PHYSICS_PROTOCOL, type FromPhysics, type ToPhysics } from './protocol.ts';
import { createTickResults } from './tickResults.ts';
import { createCharacterDriver } from './characterDriver.ts';
import { createWaterStep } from './water.ts';
import { createThreadTuner } from './threadTuner.ts';

const scope = globalThis as unknown as {
  location: { href: string };
  onmessage: ((event: MessageEvent<ToPhysics>) => void) | null;
  postMessage(message: FromPhysics | typeof JOLT_THREAD_LOADED, transfer?: Transferable[]): void;
};

let jolt: JoltModule | null = null,
  results: ReturnType<typeof createTickResults> | null = null,
  tuner: ReturnType<typeof createThreadTuner> | null = null;
const buffers: ArrayBuffer[] = [];
const water = createWaterStep();
const queued: Uint32Array[] = [];
/** The page's command buffers: `received` until a step ran them, then `spent` until the next
 *  results hand them back. The character's own words stay here. */
const received: ArrayBuffer[] = [],
  spent: ArrayBuffer[] = [];
const character = createCharacterDriver();
/** The page's messages not run yet, in its order: before the module is there, and behind a step
 *  short of room. */
const inbox: ToPhysics[] = [];
/** Seconds of a fixed step (`start.step`); the page's step the simulation stands at; the steps of
 *  the advance at the inbox's head not taken yet. */
let step = PHYSICS_STEP,
  at = 0,
  owing = 0;
let failed = false,
  /** The page's messages that may wake the world run so far, and how many had run when the page
   *  was last told the world rests: told again only after another (`PhysicsResults.heard`). */
  heard = 0,
  told = 0,
  active = 0,
  leaves = false,
  steps = 0,
  stepMs = 0,
  stepMaxMs = 0;

/** A fatal error stops the simulation: nothing steps again, and later messages are dropped. */
function fail(error: unknown) {
  const code =
    error instanceof EngineError ? error.code : jolt?.full() ? 'PHYSICS_BUDGET' : 'PHYSICS_FAILED';
  const message = String((error as Error)?.message ?? error);
  scope.postMessage({ type: 'error', code, message, fatal: true });
  jolt = results = null;
  failed = true;
  queued.length = received.length = inbox.length = 0;
}

/** Whether the world asks for steps: a body awake, a command queued, a leave owed (one held back
 *  by a full event buffer is sent by one more step, even in a world at rest), the character
 *  moving. */
const live = () => active > 0 || leaves || queued.length > 0 || character.moving();

/** Runs the queued commands and one step from the page's step `at`; `stepMs` counts the step and
 *  its buoyancy, the clock the bench reads in Node (`bench/physics/bodies.ts`), not the copy of
 *  its results; `stepMaxMs` keeps the tick's slowest fixed step; each fixed step's time steers the
 *  threads the next ones split over (`createThreadTuner`). */
function run(dt: number) {
  const move = dt > 0 ? character.command(dt, jolt!.active() > 0) : null;
  if (move) queued.push(move);
  const words = queued.length ? concat(queued.splice(0)) : null;
  const t = performance.now();
  const count = water.step(jolt!, words, dt, at);
  const ms = performance.now() - t;
  stepMs += ms;
  if (dt > 0) stepMaxMs = Math.max(stepMaxMs, ms);
  if (dt > 0 && tuner) jolt!.concurrency(tuner.step(ms));
  for (const buffer of received) spent.push(buffer);
  received.length = 0;
  character.read(jolt!.character(), dt);
  results!.gather(count, dt > 0);
  // What the next advance asks of the world: read after every step, whichever message it ran in.
  active = jolt!.active();
  leaves = jolt!.owedLeaves() > 0;
}

function concat(parts: Uint32Array[]) {
  if (parts.length === 1) return parts[0];
  const all = new Uint32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) all.set(part, (at += part.length) - part.length);
  return all;
}

/** Takes the steps a frame owes (`advance`); false while one more step's events might not fit. */
function advance({ to, steps: count }: Extract<ToPhysics, { type: 'advance' }>) {
  if (owing === 0) {
    // The frames the page sent nothing for passed at rest: their time is the waves' alone.
    at = to - count;
    // The page's clock stands still: the commands reach the bodies in place, no step waited for.
    if (count === 0) {
      if (queued.length && !results!.room()) return false;
      if (queued.length) run(0);
      return true;
    }
    if (!live()) {
      at = to;
      if (told !== heard) scope.postMessage({ type: 'rest', step: at, heard });
      told = heard;
      return true;
    }
    owing = count;
  }
  for (; owing > 0; owing--, at++, steps++) {
    if (!results!.room()) return false;
    run(step);
  }
  return true;
}

/** A query between two steps, against the last one's bodies; the commands still queued are
 *  applied first, so it sees the tiles restored with them. */
function cast({ id, queries }: Extract<ToPhysics, { type: 'cast' }>) {
  if (queued.length && results!.room()) run(0);
  const hits = jolt!.cast(queries);
  scope.postMessage({ type: 'cast', id, hits }, [hits.buffer]);
}

/** Runs one of the page's messages; false when it must wait for room. */
function handle(message: ToPhysics) {
  if (message.type === 'advance') return advance(message);
  if (message.type === 'cast') cast(message);
  else if (message.type === 'water') water.set(message.water, message.at);
  else {
    heard++;
    if (message.type === 'commands') {
      queued.push(message.words);
      received.push(message.words.buffer);
    } else if (message.type === 'character') {
      const words = character.configure(message.settings, message.feet);
      if (words) queued.push(words);
    } else if (message.type === 'input') character.press(message.input, message.jumps);
  }
  return true;
}

/** Runs the page's messages in its order, until one waits for room, then posts. The commands wait
 *  for the next step, so a kinematic move is a move over a step (pushing what it meets), never a
 *  teleport. */
function pump() {
  if (!jolt) return;
  try {
    while (inbox.length && handle(inbox[0])) inbox.shift();
  } catch (error) {
    return fail(error);
  }
  post();
}

function post() {
  const resting = owing === 0 && !live();
  const after = { active, step: at, resting, heard };
  if (results?.post({ steps, stepMs, stepMaxMs }, after, character.report, spent)) {
    steps = stepMs = stepMaxMs = 0;
    if (resting) told = heard;
  }
}

async function start(message: Extract<ToPhysics, { type: 'start' }>) {
  if (message.protocol !== PHYSICS_PROTOCOL)
    throw new EngineError('PHYSICS_FAILED', 'Physics: protocol mismatch.');
  const response = await checked(message.wasm);
  const budget = message.budget;
  // The module's threads run in workers of this same script (`thread` messages below); until
  // each has loaded, `jolt` stays unset: nothing steps, the page's messages wait in `inbox`.
  const pool =
    message.threads > 1 ? joltWorkerPool(scope.location.href, message.threads, fail) : null;
  const opened = await openJolt(await response.arrayBuffer(), budget.memoryBytes, pool);
  const started = startJolt(opened, budget, message.threads, message.step);
  await pool?.ready();
  jolt = started;
  step = message.step;
  if (pool) tuner = createThreadTuner(message.threads, step);
  results = createTickResults(jolt, budget, buffers, scope.postMessage.bind(scope));
  buffers.push(...message.buffers);
  scope.postMessage({ type: 'ready' });
  pump();
}

scope.onmessage = ({ data: message }) => {
  if (message.type === 'start') start(message).catch(fail);
  else if (message.type === 'thread')
    runJoltThread(message, () => scope.postMessage(JOLT_THREAD_LOADED)).catch(fail);
  else if (failed) return;
  else if (message.type === 'buffer') {
    buffers.push(message.buffer);
    // Results held back for a buffer go; steps held back for room in them resume.
    post();
    pump();
  } else {
    inbox.push(message);
    pump();
  }
};
