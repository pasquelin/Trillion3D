/**
 * The physics worker: it loads the Jolt module, steps it at a fixed 60 Hz and hands each tick's
 * poses and contact events back to the page in a transferable buffer. Two buffers go back and
 * forth; when the page still holds both, the tick's results wait for the next one rather than the
 * worker waiting for the page. With every body asleep and no command queued, it stops ticking: a
 * still scene costs no work here either.
 */
import {
  ASLEEP_BIT,
  EVENT_WORDS,
  MAX_CATCH_UP_STEPS,
  PHYSICS_STEP,
  POSE_WORDS,
} from '../../../sdk-core/src/physics/index.ts';
import { instantiateJolt, type JoltModule } from './joltModule.ts';
import { runJoltThread, type JoltThreadStart } from './joltThreads.ts';
import { MAX_EVENTS, PHYSICS_PROTOCOL, type FromPhysics, type ToPhysics } from './protocol.ts';

const scope = globalThis as unknown as {
  location: { href: string };
  onmessage: ((event: MessageEvent<ToPhysics>) => void) | null;
  postMessage(message: FromPhysics, transfer?: Transferable[]): void;
};

let jolt: JoltModule | null = null;
const buffers: ArrayBuffer[] = [];
const queued: Uint32Array[] = [];
let paused = false,
  timeScale = 1,
  last = 0,
  owed = 0,
  timer: ReturnType<typeof setTimeout> | null = null,
  active = 0;
const events = new Uint32Array(MAX_EVENTS * EVENT_WORDS);
/** This tick's results: one slot per body (a later step overwrites), then the events. */
let slotOf = new Int32Array(0),
  stamp = new Uint32Array(0),
  tickId = 0,
  poses = new Uint32Array(0),
  poseCount = 0,
  eventCount = 0,
  steps = 0,
  stepMs = 0;

function fail(error: unknown) {
  const text = String((error as Error)?.message ?? error);
  const budget = jolt?.full() || text.startsWith('PHYSICS_BUDGET');
  scope.postMessage({
    type: 'error',
    code: budget ? 'PHYSICS_BUDGET' : 'PHYSICS_FAILED',
    message: text,
  });
  jolt = null;
}

/** Keeps a step's poses, one slot per body, and its events. */
function gather(count: number) {
  const words = jolt!.poses(count);
  for (let r = 0; r < count; r++) {
    const index = (words[r * POSE_WORDS] & ~ASLEEP_BIT) >>> 0;
    if (stamp[index] !== tickId) {
      stamp[index] = tickId;
      slotOf[index] = poseCount++;
    }
    poses.set(words.subarray(r * POSE_WORDS, (r + 1) * POSE_WORDS), slotOf[index] * POSE_WORDS);
  }
  const fresh = jolt!.events();
  const room = Math.min(fresh.length, events.length - eventCount * EVENT_WORDS);
  events.set(fresh.subarray(0, room), eventCount * EVENT_WORDS);
  eventCount += room / EVENT_WORDS;
}

function run(dt: number) {
  const words = queued.length ? concat(queued.splice(0)) : null;
  const t = performance.now();
  gather(jolt!.step(words, dt));
  stepMs += performance.now() - t;
}

function concat(parts: Uint32Array[]) {
  if (parts.length === 1) return parts[0];
  const out = new Uint32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) out.set(part, (at += part.length) - part.length);
  return out;
}

/** Steps what the time since the last tick holds (a ceiling of catch-up steps), then posts. */
function tick() {
  timer = null;
  if (!jolt) return;
  const now = performance.now();
  if (!paused)
    owed = Math.min(owed + ((now - last) / 1000) * timeScale, MAX_CATCH_UP_STEPS * PHYSICS_STEP);
  last = now;
  try {
    // Paused, commands still reach the bodies; running, they wait for the next step, so a
    // kinematic move is a move over a step (pushing what it meets), never a teleport.
    if (queued.length && paused) run(0);
    while (!paused && owed >= PHYSICS_STEP) {
      run(PHYSICS_STEP);
      owed -= PHYSICS_STEP;
      steps++;
    }
    active = jolt.active();
  } catch (error) {
    return fail(error);
  }
  post();
  if (active > 0 && !paused) schedule(Math.max(1, ((PHYSICS_STEP - owed) * 1000) / timeScale));
}

function post() {
  const buffer = poseCount || eventCount || steps ? buffers.pop() : undefined;
  if (!buffer) return;
  const words = new Uint32Array(buffer);
  words.set(poses.subarray(0, poseCount * POSE_WORDS));
  words.set(events.subarray(0, eventCount * EVENT_WORDS), poseCount * POSE_WORDS);
  const message = { poses: poseCount, events: eventCount, steps, seconds: steps * PHYSICS_STEP };
  scope.postMessage({ type: 'results', buffer, ...message, stepMs, active }, [buffer]);
  tickId++;
  poseCount = eventCount = steps = stepMs = 0;
}

function schedule(ms: number) {
  if (timer === null) timer = setTimeout(tick, ms);
}

async function start(message: Extract<ToPhysics, { type: 'start' }>) {
  if (message.protocol !== PHYSICS_PROTOCOL) throw new Error('PHYSICS_FAILED: protocol mismatch');
  const response = await fetch(message.wasm);
  if (!response.ok) throw new Error(`PHYSICS_FAILED: ${message.wasm} ${response.status}`);
  const { bodies, memoryBytes } = message.budget;
  // The module's threads run in workers of this same script (`thread` messages below).
  const spawn = (start: JoltThreadStart) => {
    const thread = new Worker(scope.location.href, { type: 'module' });
    thread.onmessage = ({ data }) => scope.postMessage(data);
    thread.postMessage(start);
  };
  const threads = message.threads > 1 ? { count: message.threads, spawn } : null;
  jolt = await instantiateJolt(await response.arrayBuffer(), bodies, memoryBytes, threads);
  slotOf = new Int32Array(bodies);
  stamp = new Uint32Array(bodies).fill(0xffffffff);
  poses = new Uint32Array(bodies * POSE_WORDS);
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
    if (poseCount || eventCount) post();
  } else if (message.type === 'commands') {
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
