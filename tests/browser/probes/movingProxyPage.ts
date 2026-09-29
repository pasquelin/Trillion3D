/**
 * Page side of the moving-proxy probes (#27), over the engine's resident proxy
 * (`createGpuBounceProxy`) and the shipped traversal (`movingProxyTrace.ts`):
 * - `run`: one retained plane with two coincident owners, traced still, then after its second
 *   owner moved five metres along x;
 * - `runLarge`: a deep tree of 16,384 owners, some carried across the floor, traced with the
 *   bound the tree derives, with no bound at all and with the built tree's bound; then once the
 *   owners stop, on the still path.
 */
import { IDENTITY_MATRIX4 } from '../../../packages/sdk-core/src/math/matrix/matrix4.ts';
import {
  floorProxy,
  mixedProxy,
  ownedProxy,
} from '../../../packages/sdk-core/src/scene/core/proxy.fixture.ts';
import { BOUNCE_SETTINGS } from '../../../packages/sdk-core/src/index.ts';
import { createGpuBounceProxy } from '../../../packages/sdk-browser/src/bounce/proxy.ts';
import { PROXY_HEADER_WORDS } from '../../../packages/sdk-browser/src/bounce/nodeWgsl.ts';
import { createTraceRig } from './movingProxyTrace.ts';
import { ouvrirAppareil as openDevice } from './webgpuDevice.ts';

/** Straight down onto the plane: over the canonical pose, then over the moved owner's pose. */
const RAYS = new Float32Array([0.25, 0.25, 1, 0, 0, 0, -1, 0, 5.25, 0.25, 1, 0, 0, 0, -1, 0]);

/** Source node 1 translated by five metres along x; every other node at its bind pose. */
const worldOf = (source: number) => {
  const world = [...IDENTITY_MATRIX4];
  world[12] = source === 1 ? 5 : 0;
  return world;
};

export async function run() {
  const gpu = await openDevice();
  if (!gpu) return { unavailable: 'no WebGPU adapter' };
  const { device, erreurs: errors } = gpu;
  const proxy = ownedProxy();
  const resident = createGpuBounceProxy(device, proxy);
  // The owner ranges follow triangles, node bounds, node children and triangle groups.
  const { triangles, nodeBounds, nodeChildren, triangleGroups, groupOffsets } = proxy.data;
  const rangesByte =
    (PROXY_HEADER_WORDS +
      triangles.length +
      nodeBounds.length +
      nodeChildren.length +
      triangleGroups.length) *
    4;
  const rig = createTraceRig(gpu, resident.buffer, RAYS);
  // A still proxy reads no owner word: with its owner ranges overwritten by an owner that does not
  // exist, it still hits its posed plane. The real ranges come back before anything moves.
  device.queue.writeBuffer(resident.buffer, rangesByte, new Uint32Array([7, 9]));
  const still = await rig.trace();
  device.queue.writeBuffer(resident.buffer, rangesByte, groupOffsets.slice());
  const moved = resident.sync(worldOf);
  const after = await rig.trace();
  const dynamic = resident.dynamic;
  rig.dispose();
  resident.dispose();
  const info = await gpu.fermer();
  const { compilation } = rig;
  return { adapter: info.court, errors, compilation, moved, dynamic, still, after };
}

/** Down onto the lone plane's new pose and its old one, onto the frame left in place, onto the door. */
const MIXED_RAYS = new Float32Array(
  [0.25, 5.25, 0.25, 0.25, 2.25, 0.25, 2.25, 5.25].flatMap((value, at) =>
    at % 2 ? [value, 1, 0, 0, 0, -1, 0] : [value],
  ),
);

/** Sources 0 and 1 lifted five metres along y: the lone plane and the door, not the frame. */
const lifted = (source: number) => {
  const world = [...IDENTITY_MATRIX4];
  world[13] = source <= 1 ? 5 : 0;
  return world;
};

export async function runMixed() {
  const gpu = await openDevice();
  if (!gpu) return { unavailable: 'no WebGPU adapter' };
  const { device, erreurs: errors } = gpu;
  const proxy = mixedProxy();
  const resident = createGpuBounceProxy(device, proxy);
  const moved = resident.sync(lifted);
  const settled = resident.sync(lifted);
  const dynamic = resident.dynamic;
  // The lone plane's owner range, poisoned: its posed leaf must never read it.
  const { triangles, nodeBounds, nodeChildren, triangleGroups } = proxy.data;
  const words = triangles.length + nodeBounds.length + nodeChildren.length + triangleGroups.length;
  device.queue.writeBuffer(resident.buffer, (PROXY_HEADER_WORDS + words) * 4, new Uint32Array([7]));
  const rig = createTraceRig(gpu, resident.buffer, MIXED_RAYS);
  const rays = await rig.trace();
  rig.dispose();
  resident.dispose();
  const info = await gpu.fermer();
  const { compilation } = rig;
  return { adapter: info.court, errors, compilation, moved, settled, dynamic, rays };
}

const SIDE = 128;

/** Every 97th owner lifted 2.5 m and carried across the floor: the boxes of its ancestors then
 *  span the scene, and a ray crosses many of them before it reaches what it hits. */
function carried(triangles: Float32Array) {
  const worlds = new Map<number, number[]>();
  for (let owner = 0; owner < SIDE * SIDE; owner += 97) {
    const world = [...IDENTITY_MATRIX4];
    world[12] = ((owner * 37) % SIDE) + 0.3 - triangles[owner * 9];
    world[13] = ((owner * 91) % SIDE) + 0.6 - triangles[owner * 9 + 1];
    world[14] = 2.5 + (owner % 7) * 0.01;
    worlds.set(owner, world);
  }
  return (source: number) => worlds.get(source) ?? IDENTITY_MATRIX4;
}

/** Level rays through the lifted owners, then slanted rays down onto floor triangles. */
function largeRays() {
  const rays: number[] = [];
  const level = Math.hypot(1, 0.05),
    slant = Math.hypot(0.3, 0.2, 1);
  for (let row = 0; row < 256; row++)
    rays.push(-1, row * 0.5 + 0.05, 3, 0, 1 / level, 0.05 / level, 0, 0);
  // Each aimed at a point of a floor triangle, (0.2, 0.1) into its cell where its face rises to
  // 0.1 m: a ray that misses the moved owners lands on the floor, never in a gap between tiles.
  for (let cell = 0; cell < 256; cell++) {
    const x = (cell % 16) * 8 + 0.2 - 0.3 * 4.9,
      y = (cell >> 4) * 8 + 0.1 - 0.2 * 4.9;
    rays.push(x, y, 5, 0, 0.3 / slant, 0.2 / slant, -1 / slant, 0);
  }
  return new Float32Array(rays);
}

export async function runLarge() {
  const gpu = await openDevice();
  if (!gpu) return { unavailable: 'no WebGPU adapter' };
  const { device, erreurs: errors } = gpu;
  const proxy = floorProxy(SIDE, 2);
  const resident = createGpuBounceProxy(device, proxy);
  const rig = createTraceRig(gpu, resident.buffer, largeRays());
  const move = carried(proxy.data.triangles);
  const moved = resident.sync(move);
  const steps = resident.steps;
  const bound = await rig.trace();
  const uncapped = await rig.trace('0xffffffffu');
  const built = await rig.trace(`${BOUNCE_SETTINGS.traversalSteps}u`);
  const settled = resident.sync(move);
  const dynamic = resident.dynamic;
  const rest = await rig.trace();
  rig.dispose();
  resident.dispose();
  const info = await gpu.fermer();
  const { compilation } = rig;
  const nodes = proxy.nodes;
  return {
    adapter: info.court,
    ...{ errors, compilation, moved, settled, dynamic, nodes, steps },
    ...{ bound, uncapped, built, rest },
  };
}
