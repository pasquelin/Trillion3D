/**
 * The physics worker: it loads the Jolt module, steps it at a fixed 60 Hz and hands each tick's
 * poses and contact events back to the page in a transferable buffer. Two buffers go back and
 * forth, and a tick writes straight into a free one; when the page still holds both, the tick's
 * results wait in a staging copy for the next buffer rather than the worker waiting for the page.
 * With every body asleep, no command queued and no leave owed, it stops ticking: a still scene
 * costs no work here either.
 */
import { EngineError } from '../../../sdk-core/src/contracts/cache.ts';
import { PHYSICS_STEP } from '../../../sdk-core/src/physics/index.ts';
import { openJolt, startJolt, type JoltModule } from './joltModule.ts';
import { runJoltThread, type JoltThreadStart } from './joltThreads.ts';
import { PHYSICS_PROTOCOL, type FromPhysics, type ToPhysics } from './protocol.ts';
import { createTickResults } from './tickResults.ts';
import { createCharacterDriver } from './characterDriver.ts';
import { createWaterStep } from './water.ts';
import { createStepClock } from './stepClock.ts';

const scope = globalThis as unknown as {
  location: { href: string };
  onmessage: ((event: MessageEvent<ToPhysics>) => void) | null;
  postMessage(message: FromPhysics, transfer?: Transferable[]): void;
};

let jolt: JoltModule | null = null,
  results: ReturnType<typeof createTickResults> | null = null;
const buffers: ArrayBuffer[] = [];
const water = createWaterStep();
const clock = createStepClock(water);
const queued: Uint32Array[] = [];
const character = createCharacterDriver();
let timer: ReturnType<typeof setTimeout> | null = null,
  active = 0,
  steps = 0,
  stepMs = 0,
  stepMaxMs = 0;

/** A fatal error stops the simulation: nothing steps again, and later commands are dropped. */
function fail(error: unknown) {
  const code =
    error instanceof EngineError ? error.code : jolt?.full() ? 'PHYSICS_BUDGET' : 'PHYSICS_FAILED';
  const message = String((error as Error)?.message ?? error);
  scope.postMessage({ type: 'error', code, message, fatal: true });
  jolt = results = null;
  queued.length = 0;
}

/** Runs the queued commands and one step; `stepMs` counts the step and its buoyancy, the clock
 *  the bench reads in Node (`scripts/bench-physics.ts`), not the copy of its results;
 *  `stepMaxMs` keeps the tick's slowest fixed step. */
function run(dt: number) {
  const move = dt > 0 ? character.command(dt, jolt!.active() > 0) : null;
  if (move) queued.push(move);
  const words = queued.length ? concat(queued.splice(0)) : null;
  const t = performance.now();
  const count = water.step(jolt!, words, dt);
  const spent = performance.now() - t;
  stepMs += spent;
  if (dt > 0) stepMaxMs = Math.max(stepMaxMs, spent);
  character.read(jolt!.character(), dt);
  results!.gather(count);
}

function concat(parts: Uint32Array[]) {
  if (parts.length === 1) return parts[0];
  const all = new Uint32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) all.set(part, (at += part.length) - part.length);
  return all;
}

/** Steps what the time since the last tick holds (a ceiling of catch-up steps), then posts. */
function tick() {
  timer = null;
  if (!jolt) return;
  clock.tick(performance.now());
  let owing: boolean;
  try {
    // Paused, commands still reach the bodies; running, they wait for the next step, so a
    // kinematic move is a move over a step (pushing what it meets), never a teleport.
    if (queued.length && clock.paused && results!.room()) run(0);
    while (results!.room() && clock.step()) {
      run(PHYSICS_STEP);
      steps++;
    }
    active = jolt.active();
    // A leave held back by a full event buffer is sent by one more step, even in a world at rest.
    owing = jolt.owedLeaves() > 0;
  } catch (error) {
    return fail(error);
  }
  post();
  if ((active > 0 || owing || character.moving()) && !clock.paused) schedule(clock.delay());
}

function post() {
  if (results?.post({ steps, stepMs, stepMaxMs }, active, character.report, water))
    steps = stepMs = stepMaxMs = 0;
}

/** A resting world steps at once: what the page just sent is owed now, not a frame later. */
function wake() {
  if (!jolt) return;
  clock.wake(performance.now(), timer === null);
  schedule(0);
}

function schedule(ms: number) {
  if (timer === null) timer = setTimeout(tick, ms);
}

async function start(message: Extract<ToPhysics, { type: 'start' }>) {
  if (message.protocol !== PHYSICS_PROTOCOL)
    throw new EngineError('PHYSICS_FAILED', 'Physics: protocol mismatch.');
  const response = await fetch(message.wasm);
  if (!response.ok)
    throw new EngineError('PHYSICS_FAILED', `Physics: ${message.wasm} ${response.status}.`);
  const budget = message.budget;
  // The module's threads run in workers of this same script (`thread` messages below).
  const spawn = (start: JoltThreadStart) => {
    const thread = new Worker(scope.location.href, { type: 'module' });
    thread.onmessage = ({ data }) => scope.postMessage(data);
    thread.postMessage(start);
  };
  const threads = message.threads > 1 ? { count: message.threads, spawn } : null;
  const opened = await openJolt(await response.arrayBuffer(), budget.memoryBytes, threads);
  jolt = startJolt(opened, budget, message.threads);
  results = createTickResults(jolt, budget, buffers, scope.postMessage.bind(scope));
  buffers.push(...message.buffers);
  clock.start(performance.now());
  scope.postMessage({ type: 'ready' });
  schedule(0);
}

scope.onmessage = ({ data: message }) => {
  if (message.type === 'start') start(message).catch(fail);
  else if (message.type === 'thread') runJoltThread(message).catch(fail);
  else if (message.type === 'buffer') {
    buffers.push(message.buffer);
    post();
    // A tick held back for room in its results resumes.
    if (jolt && (clock.owed >= PHYSICS_STEP || queued.length)) schedule(0);
  } else if (message.type === 'water') {
    water.set(message.water, message.epoch);
    clock.water(performance.now(), timer === null);
    schedule(0);
  } else if (message.type === 'cast') {
    // Between two ticks, against the last step's bodies; the commands still queued are applied
    // first, so a query sees the tiles restored with it.
    if (!jolt) return;
    try {
      if (queued.length && results!.room()) run(0);
      const hits = jolt.cast(message.queries);
      scope.postMessage({ type: 'cast', id: message.id, hits }, [hits.buffer]);
    } catch (error) {
      fail(error);
    }
  } else if (message.type === 'commands') {
    // Only a running simulation queues them: the page sends none before `ready`.
    if (!jolt) return;
    queued.push(message.words);
    wake();
  } else if (message.type === 'character') {
    // Kept before `ready` too: the module makes the body before its first step.
    const words = character.configure(message.settings, message.feet);
    if (words) queued.push(words);
    wake();
  } else if (message.type === 'input') {
    character.press(message.input, message.jumps);
    wake();
  } else {
    clock.set(performance.now(), timer === null, message.paused, message.timeScale);
    schedule(0);
  }
};
