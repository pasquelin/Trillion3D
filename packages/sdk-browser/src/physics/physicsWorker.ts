/**
 * The physics worker: it loads the Jolt module, steps it at a fixed 60 Hz and hands each tick's
 * poses and contact events back to the page in a transferable buffer. Two buffers go back and
 * forth, and a tick writes straight into a free one; when the page still holds both, the tick's
 * results wait in a staging copy for the next buffer rather than the worker waiting for the page.
 * With every body asleep, no command queued and no leave owed, it stops ticking: a still scene
 * costs no work here either.
 */
import { EngineError } from '../../../sdk-core/src/contracts/cache.ts';
import { MAX_CATCH_UP_STEPS, PHYSICS_STEP } from '../../../sdk-core/src/physics/index.ts';
import { openJolt, startJolt, type JoltModule } from './joltModule.ts';
import { runJoltThread, type JoltThreadStart } from './joltThreads.ts';
import { PHYSICS_PROTOCOL, type FromPhysics, type ToPhysics } from './protocol.ts';
import { createTickResults } from './tickResults.ts';
import { createWaterStep } from './water.ts';

const scope = globalThis as unknown as {
  location: { href: string };
  onmessage: ((event: MessageEvent<ToPhysics>) => void) | null;
  postMessage(message: FromPhysics, transfer?: Transferable[]): void;
};

let jolt: JoltModule | null = null,
  results: ReturnType<typeof createTickResults> | null = null;
const buffers: ArrayBuffer[] = [];
const water = createWaterStep();
const queued: Uint32Array[] = [];
let paused = false,
  timeScale = 1,
  last = 0,
  owed = 0,
  timer: ReturnType<typeof setTimeout> | null = null,
  active = 0,
  steps = 0,
  stepMs = 0;

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
 *  the bench reads in Node (`scripts/bench-physics.ts`), not the copy of its results. */
function run(dt: number) {
  const words = queued.length ? concat(queued.splice(0)) : null;
  const t = performance.now();
  const count = water.step(jolt!, words, dt);
  stepMs += performance.now() - t;
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
  const now = performance.now();
  if (!paused)
    owed = Math.min(owed + ((now - last) / 1000) * timeScale, MAX_CATCH_UP_STEPS * PHYSICS_STEP);
  last = now;
  let owing: boolean;
  try {
    // Paused, commands still reach the bodies; running, they wait for the next step, so a
    // kinematic move is a move over a step (pushing what it meets), never a teleport.
    if (queued.length && paused && results!.room()) run(0);
    while (!paused && owed >= PHYSICS_STEP && results!.room()) {
      run(PHYSICS_STEP);
      owed -= PHYSICS_STEP;
      steps++;
    }
    active = jolt.active();
    // A leave held back by a full event buffer is sent by one more step, even in a world at rest.
    owing = jolt.owedLeaves() > 0;
  } catch (error) {
    return fail(error);
  }
  post();
  if ((active > 0 || owing) && !paused)
    schedule(Math.max(1, ((PHYSICS_STEP - owed) * 1000) / timeScale));
}

function post() {
  if (results?.post(steps, stepMs, active)) steps = stepMs = 0;
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
  last = performance.now();
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
    if (jolt && (owed >= PHYSICS_STEP || queued.length)) schedule(0);
  } else if (message.type === 'water') {
    water.set(message.water);
    schedule(0);
  } else if (message.type === 'commands') {
    // Only a running simulation queues them: the page sends none before `ready`.
    if (!jolt) return;
    queued.push(message.words);
    // A resting world steps at once: the command's step is owed now, not a frame later.
    if (timer === null) {
      last = performance.now();
      if (!paused) owed = Math.max(owed, PHYSICS_STEP);
    }
    schedule(0);
  } else {
    paused = message.paused;
    timeScale = message.timeScale;
    last = performance.now();
    schedule(0);
  }
};
