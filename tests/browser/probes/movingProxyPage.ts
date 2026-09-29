/**
 * Page side of the moving-proxy probes (#27), over the engine's resident proxy
 * (`createGpuBounceProxy`) and the shipped traversal (`movingProxyTrace.ts`):
 * - `executer`: one retained plane with two coincident owners, traced still, then after its
 *   second owner moved five metres along x;
 * - `executerLarge`: a deep tree of 16,384 owners, some carried across the floor, traced with
 *   the bound the tree derives, with no bound at all and with the built tree's bound; then
 *   once the owners stop, on the still path.
 */
import { IDENTITY_MATRIX4 } from '../../../packages/sdk-core/src/math/matrix/matrix4.ts';
import { floorProxy, ownedProxy } from '../../../packages/sdk-core/src/scene/core/proxy.fixture.ts';
import { BOUNCE_SETTINGS } from '../../../packages/sdk-core/src/index.ts';
import { createGpuBounceProxy } from '../../../packages/sdk-browser/src/bounce/proxy.ts';
import { createTraceRig } from './movingProxyTrace.ts';
import { ouvrirAppareil } from './webgpuDevice.ts';

/** Straight down onto the plane: over the canonical pose, then over the moved owner's pose. */
const RAYS = new Float32Array([0.25, 0.25, 1, 0, 0, 0, -1, 0, 5.25, 0.25, 1, 0, 0, 0, -1, 0]);

/** Source node 1 translated by five metres along x; every other node at its bind pose. */
const worldOf = (source: number) => {
  const world = [...IDENTITY_MATRIX4];
  world[12] = source === 1 ? 5 : 0;
  return world;
};

export async function executer() {
  const appareil = await ouvrirAppareil();
  if (!appareil) return { indisponible: 'no WebGPU adapter' };
  const { device, erreurs } = appareil;
  const resident = createGpuBounceProxy(device, ownedProxy());
  const rig = createTraceRig(appareil, resident.buffer, RAYS);
  const still = await rig.trace();
  const moved = resident.sync(worldOf);
  const after = await rig.trace();
  const dynamic = resident.dynamic;
  rig.dispose();
  resident.dispose();
  const info = await appareil.fermer();
  const { compilation } = rig;
  return { adaptateur: info.court, erreurs, compilation, moved, dynamic, still, after };
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

/** Level rays through the lifted owners, then slanted rays down onto the floor. */
function largeRays() {
  const rays: number[] = [];
  const level = Math.hypot(1, 0.05),
    slant = Math.hypot(0.3, 0.2, 1);
  for (let row = 0; row < 256; row++)
    rays.push(-1, row * 0.5 + 0.05, 3, 0, 1 / level, 0.05 / level, 0, 0);
  for (let cell = 0; cell < 256; cell++)
    rays.push(
      (cell % 16) * 8 + 0.3,
      (cell >> 4) * 8 + 0.7,
      5,
      0,
      0.3 / slant,
      0.2 / slant,
      -1 / slant,
      0,
    );
  return new Float32Array(rays);
}

export async function executerLarge() {
  const appareil = await ouvrirAppareil();
  if (!appareil) return { indisponible: 'no WebGPU adapter' };
  const { device, erreurs } = appareil;
  const proxy = floorProxy(SIDE, 2);
  const resident = createGpuBounceProxy(device, proxy);
  const rig = createTraceRig(appareil, resident.buffer, largeRays());
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
  const info = await appareil.fermer();
  const { compilation } = rig;
  const nodes = proxy.nodes;
  return {
    adaptateur: info.court,
    ...{ erreurs, compilation, moved, settled, dynamic, nodes, steps },
    ...{ bound, uncapped, built, rest },
  };
}
