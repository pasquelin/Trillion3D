import type { NodeLike, SkyEngine } from './engine.ts';
import { random } from './random.ts';
import type { Wind } from './wind.ts';

/** Espy's rule: a cloud base rises 125 m per degree between air temperature and dew point. */
const METRES_PER_DEGREE = 125;
/** A fair-weather cumulus is about as deep as it is wide; its width spans 0.5–2 km. */
const MIN_WIDTH = 500;
const MAX_WIDTH = 2_000;

export type CloudSettings = {
  /** Air temperature minus dew point at the ground, °C: sets the cloud base. */
  dewSpread: number;
  /** Fraction of the sky covered, 0–1 (oktas / 8). */
  cover: number;
  /** Most clouds kept at once: the layer's cost is bounded by it, never by the world. */
  count: number;
};

/**
 * A coordinate brought into the `window` wide square centred on `centre`: a cloud that
 * drifts out of one side comes back on the other, so a bounded set covers any distance.
 */
export function wrapAround(value: number, centre: number, window: number): number {
  const offset = value - centre + window / 2;
  return centre + (offset - Math.floor(offset / window) * window) - window / 2;
}

/**
 * The side of the square the clouds share: `count` clouds of mean area cover the requested
 * fraction of it. Fewer clouds or thinner cover make the square larger, never denser.
 */
export function cloudWindow(settings: CloudSettings): number {
  const meanWidth = (MIN_WIDTH + MAX_WIDTH) / 2;
  const area = (Math.PI / 4) * meanWidth * meanWidth;
  return Math.sqrt((settings.count * area) / Math.max(settings.cover, 0.01));
}

type Cloud = { node: NodeLike; x: number; z: number };

export type Clouds = {
  node: NodeLike;
  base: number;
  window: number;
  /** Drifts the clouds with the wind at their base and keeps them around `camera`. */
  update(seconds: number, camera: { x: number; z: number }, wind: Wind): void;
  /** Where each cloud stands now (x, z): for tests and for the page's minimap. */
  positions(): { x: number; z: number }[];
};

/**
 * A layer of soft cumulus: each cloud a few flattened, alpha-blended puffs sharing one
 * geometry and one material (the engine instances what shares a mesh), casting shadows.
 */
export function createClouds(engine: SkyEngine, seed: number, settings: CloudSettings): Clouds {
  const next = random(seed);
  const base = METRES_PER_DEGREE * settings.dewSpread;
  const window = cloudWindow(settings);
  const puff = engine.geometry.sphere(1, 12, 8);
  // Waiting on the engine: volumetric clouds (ray marching); these are blended shells.
  const vapour = engine.material.meshStandard({
    color: 0xffffff,
    roughness: 1,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
  });
  const node = engine.object.group();
  const clouds: Cloud[] = [];
  for (let index = 0; index < settings.count; index++) {
    const width = MIN_WIDTH + next() * (MAX_WIDTH - MIN_WIDTH);
    const cloud = engine.object.group();
    const puffs = 3 + Math.floor(next() * 4);
    for (let p = 0; p < puffs; p++) {
      const body = engine.object.mesh(puff, vapour);
      const r = width * (0.25 + next() * 0.2);
      body.scale.set(r, r * (0.45 + next() * 0.25), r * (0.8 + next() * 0.4));
      body.position.set((next() - 0.5) * width * 0.6, r * 0.2, (next() - 0.5) * width * 0.6);
      // Waiting on the engine: shadows from blended surfaces (cloud shadows on the ground).
      body.castShadow = true;
      cloud.add(body);
    }
    const x = (next() - 0.5) * window;
    const z = (next() - 0.5) * window;
    cloud.position.set(x, base + width * 0.3, z);
    node.add(cloud);
    clouds.push({ node: cloud, x, z });
  }
  return {
    node,
    base,
    window,
    update(seconds, camera, wind) {
      const drift = wind.at(base);
      for (const cloud of clouds) {
        cloud.x = wrapAround(cloud.x + drift.x * seconds, camera.x, window);
        cloud.z = wrapAround(cloud.z + drift.z * seconds, camera.z, window);
        cloud.node.position.set(cloud.x, cloud.node.position.y, cloud.z);
      }
    },
    positions: () => clouds.map(({ x, z }) => ({ x, z })),
  };
}
