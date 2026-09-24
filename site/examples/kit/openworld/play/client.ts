import { lerp, slerp, type Q } from './math3.ts';
import { H, STEP, type FromWorker, type Inputs, type ToWorker } from './protocol.ts';

/**
 * The page's side of the simulation worker. It keeps the last two snapshots it received and
 * gives back each transferred buffer at once, so the worker always has one to write; the frame
 * reads a pose between the two (one step behind, never waiting on the worker).
 */
export type Client = {
  /** Resolves once Jolt is loaded and the first step ran. */
  ready: Promise<void>;
  /** Snapshots received so far. */
  received(): number;
  /** Share of the step elapsed since the newest snapshot, 0 to 1: where between the two to read. */
  blend(): number;
  prev: Float32Array;
  next: Float32Array;
  send(message: Exclude<ToWorker, { type: 'start' | 'buffer' }>): void;
  inputs(inputs: Inputs): void;
  dispose(): void;
};

export function client(
  url: string,
  start: Omit<Extract<ToWorker, { type: 'start' }>, 'buffers' | 'type'>,
  length: number,
): Client {
  const worker = new Worker(url, { type: 'module' });
  const prev = new Float32Array(length);
  const next = new Float32Array(length);
  let count = 0;
  let arrived = 0;
  let resolve: () => void = () => {};
  let reject: (error: Error) => void = () => {};
  const ready = new Promise<void>((yes, no) => ([resolve, reject] = [yes, no]));
  worker.onmessage = (event: MessageEvent<FromWorker>) => {
    const message = event.data;
    if (message.type === 'error') reject(new Error(message.message));
    if (message.type !== 'snapshot') return;
    prev.set(count ? next : new Float32Array(message.buffer));
    next.set(new Float32Array(message.buffer));
    arrived = performance.now();
    worker.postMessage({ type: 'buffer', buffer: message.buffer } satisfies ToWorker, [
      message.buffer,
    ]);
    if (++count === 1) resolve();
  };
  worker.onerror = (event) => reject(new Error(event.message));
  const buffers = [new ArrayBuffer(length * 4), new ArrayBuffer(length * 4)];
  worker.postMessage({ type: 'start', ...start, buffers } satisfies ToWorker, buffers);
  const send = (message: Exclude<ToWorker, { type: 'start' | 'buffer' }>) =>
    worker.postMessage(message);
  return {
    ready,
    received: () => count,
    blend: () => Math.min(1, (performance.now() - arrived) / (STEP * 1000)),
    prev,
    next,
    send,
    inputs: (inputs) => send({ type: 'inputs', inputs }),
    dispose: () => worker.terminate(),
  };
}

/** A position between the two snapshots at `at` (x, y, z relative to each one's origin), in world metres. */
export function between(
  c: Pick<Client, 'prev' | 'next'>,
  at: number,
  t: number,
): [number, number, number] {
  const { prev, next } = c;
  return [
    lerp(prev[at] + prev[H.originX], next[at] + next[H.originX], t),
    lerp(prev[at + 1], next[at + 1], t),
    lerp(prev[at + 2] + prev[H.originZ], next[at + 2] + next[H.originZ], t),
  ];
}

/** A quaternion between the two snapshots at `at`. */
export function turnBetween(c: Pick<Client, 'prev' | 'next'>, at: number, t: number): Q {
  const read = (from: Float32Array): Q => [from[at], from[at + 1], from[at + 2], from[at + 3]];
  return slerp(read(c.prev), read(c.next), t);
}

/** An angle between the two snapshots, the short way round. */
export function angleBetween(c: Pick<Client, 'prev' | 'next'>, at: number, t: number) {
  const [a, b] = [c.prev[at], c.next[at]];
  const turn = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + turn * t;
}
