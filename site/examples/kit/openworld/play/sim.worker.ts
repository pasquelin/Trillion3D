/**
 * The simulation worker's shell (`runtime/openworldSim.js`): it loads Jolt, fetches the tiles,
 * steps the simulation at a fixed 60 Hz and hands each snapshot back to the page as a
 * transferable buffer. Two buffers go back and forth; when the page still holds both, the step's
 * snapshot is skipped rather than waited for. Everything it steps lives in `sim/`.
 */
import { idleInputs, STEP, type FromWorker, type Inputs, type ToWorker } from './protocol.ts';
import { collisionMeshPath, decodeCollisionMesh, type ColliderInstance } from './collision.ts';
import { createSim, step, type Sim } from './sim/core.ts';
import type { Jolt } from './sim/physics.ts';
import { teleport } from './sim/player.ts';
import { writeSnapshot } from './sim/snapshot.ts';

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
  postMessage(message: FromWorker, transfer?: Transferable[]): void;
};

let sim: Sim | null = null;
let inputs: Inputs = idleInputs();
const buffers: ArrayBuffer[] = [];
let last = 0;
let owed = 0;

const tileUrl = (template: string, tx: number, tz: number) =>
  template.replace('{tx}', String(tx)).replace('{tz}', String(tz));

async function fetched(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response;
}

async function start(message: Extract<ToWorker, { type: 'start' }>) {
  const module = (await import(message.jolt)) as { default: () => Promise<Jolt> };
  const J = await module.default();
  const colliders = message.colliders;
  sim = createSim(J, message.world, message.limits, {
    heights: async (tx, tz) =>
      new Float32Array(await (await fetched(tileUrl(message.heights, tx, tz))).arrayBuffer()),
    colliders: colliders
      ? {
          tile: async (tx, tz) =>
            (await (await fetched(tileUrl(colliders, tx, tz))).json()) as ColliderInstance[],
          // Prop meshes lie in `props/` beside the tiles' files.
          mesh: async (prop) =>
            decodeCollisionMesh(
              await (
                await fetched(new URL(collisionMeshPath(prop), tileUrl(colliders, 0, 0)).href)
              ).arrayBuffer(),
            ),
        }
      : undefined,
  });
  buffers.push(...message.buffers);
  last = performance.now();
  scope.postMessage({ type: 'ready' });
  tick();
}

/** Steps as many fixed steps as the time since the last tick holds (four at most), then posts. */
function tick() {
  if (!sim) return;
  const now = performance.now();
  owed = Math.min(owed + (now - last) / 1000, 4 * STEP);
  last = now;
  let stepped = false;
  while (owed >= STEP) {
    step(sim, inputs, STEP);
    owed -= STEP;
    stepped = true;
  }
  const buffer = stepped ? buffers.pop() : undefined;
  if (buffer) {
    writeSnapshot(sim, new Float32Array(buffer));
    scope.postMessage({ type: 'snapshot', buffer }, [buffer]);
  }
  setTimeout(tick, Math.max(1, (STEP - owed) * 1000));
}

scope.onmessage = (event) => {
  const message = event.data;
  if (message.type === 'start')
    start(message).catch((error: unknown) =>
      scope.postMessage({ type: 'error', message: String((error as Error)?.stack ?? error) }),
    );
  else if (message.type === 'inputs') inputs = message.inputs;
  else if (message.type === 'buffer') buffers.push(message.buffer);
  else if (sim && message.type === 'teleport') teleport(sim, message.name);
};
