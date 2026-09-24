import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { exampleModules } from './docs/examples/capture.ts';
import { geometry, light, material, math, object } from '../packages/sdk-browser/src/index.ts';
import { WaterSurface } from '../packages/sdk-core/src/fluids/waterSurface.ts';
import type { WaterSpec } from '../packages/sdk-core/src/fluids/buoyancy.ts';
import type { Object3D } from '../packages/sdk-core/src/world/object/object3d.ts';
import type { Mesh } from '../packages/sdk-core/src/world/object/mesh.ts';
import { seeded } from '../site/examples/kit/random.ts';

type Hook = () => void;
type Spec = unknown[] | boolean | (() => void);

/**
 * Runs `site/examples/floating-crates.html` in Node on the engine's own scene objects, with a
 * world that records what its scene tells the runtime. A written shape (`content`) is cut again
 * and opens the session again (docs/SDK.md, "Live material values"): a page that writes one every
 * frame never keeps a session long enough to draw, the blank thumbnail of #522.
 */
async function floatingCrates(set: Record<string, unknown> = {}) {
  const html = await readFile(
    resolve(import.meta.dirname, '../site/examples/floating-crates.html'),
    'utf8',
  );
  const [source] = await exampleModules(html);
  const told = { content: 0, pose: 0 };
  const scene = object.group();
  scene._link = {
    pose: () => void told.pose++,
    posed: () => void told.pose++,
    structure: () => {},
    content: () => void told.content++,
  } as unknown as Object3D['_link'];
  let surface: WaterSurface | null = null,
    time = 0;
  const frames: Hook[] = [];
  const createWorld = () => ({
    scene,
    camera: { position: { set() {} } },
    controls: { target: { set() {} } },
    physics: {
      timeScale: 1,
      set water(spec: WaterSpec) {
        surface = new WaterSurface(spec);
      },
      get waterSurface() {
        return surface?.setTime(time) ?? null;
      },
      stats: { bodies: 0, active: 0, stepMs: 0 },
    },
    onFrame: (hook: Hook) => frames.push(hook),
    invalidate() {},
  });
  // The kit's panel, without a document: its values at their defaults unless `set`, told once.
  const controls = (specs: Record<string, Spec>, onChange: (values: object) => void) => {
    const values = Object.fromEntries(
      Object.entries(specs)
        .filter(([, spec]) => typeof spec !== 'function')
        .map(([key, spec]) => [key, key in set ? set[key] : Array.isArray(spec) ? spec[2] : spec]),
    );
    onChange(values);
    return values;
  };
  const modules = {
    engine: { createWorld, geometry, material, object, light, math },
    kit: { controls, readout: () => () => {}, seeded },
  };
  const body = source.replace(
    /import \{([^}]*)\} from '\.\.\/runtime\/(engine|kit)\.js';/g,
    'const {$1} = modules.$2;',
  );
  new Function('modules', `'use strict';${body}`)(modules);
  return {
    told,
    scene,
    surface: () => surface!,
    frame(seconds: number) {
      time = seconds;
      for (const hook of frames) hook();
    },
  };
}

test('floating crates moves its drawn waves by poses: a frame writes no shape', async () => {
  const page = await floatingCrates();
  page.frame(0);
  page.told.content = page.told.pose = 0;
  for (const seconds of [0.1, 0.2, 0.3]) page.frame(seconds);
  assert.equal(page.told.content, 0, 'no shape or material written by a frame');
  assert.ok(page.told.pose > 0, 'the drawn surface still follows the waves');
});

for (const waves of [1, 2])
  test(`floating crates tiles its water on the waves (${waves}×): every corner within 3 cm of its point, neighbours within 6 cm`, async () => {
    const page = await floatingCrates({ waves });
    const tiles: Mesh[] = [];
    page.scene.traverse((node) => {
      if ((node as Mesh).material?.transparent) tiles.push(node as Mesh);
    });
    assert.ok(tiles.length > 100, 'the water is drawn as tiles');
    const box = tiles[0].geometry.computeBoundingBox()!;
    const cellX = box.max.x - box.min.x,
      cellZ = box.max.z - box.min.z;
    const corner = math.vector3(),
      at = new Float64Array(3);
    let worst = 0,
      seam = 0;
    for (const seconds of [0.4, 1.7, 5.3]) {
      page.frame(seconds);
      const surface = page.surface();
      page.scene.updateMatrixWorld();
      // Every tile corner, keyed by the rest grid point it stands for: the rest point the waves
      // carry nearest to it (walking back their offset), snapped to the grid of cells.
      const rest: [number, number, number, number, number][] = [];
      for (const tile of tiles)
        for (const x of [box.min.x, box.max.x])
          for (const z of [box.min.z, box.max.z]) {
            tile.localToWorld(corner.set(x, 0, z));
            let restX = corner.x,
              restZ = corner.z;
            for (let step = 0; step < 8; step++) {
              surface.point(restX, restZ, at);
              restX -= at[0] - corner.x;
              restZ -= at[2] - corner.z;
            }
            rest.push([restX, restZ, corner.x, corner.y, corner.z]);
          }
      // The grid is centred on the basin: its first rest point is half its cells from the middle.
      const half = (cell: number, walked: number[]) =>
        (-Math.round((Math.max(...walked) - Math.min(...walked)) / cell) * cell) / 2;
      const left = half(cellX, rest.map(([x]) => x)),
        back = half(cellZ, rest.map(([, z]) => z));
      const nodes = new Map<string, number[][]>();
      for (const [restX, restZ, x, y, z] of rest) {
        const i = Math.round((restX - left) / cellX),
          k = Math.round((restZ - back) / cellZ);
        surface.point(left + i * cellX, back + k * cellZ, at);
        worst = Math.max(worst, Math.hypot(at[0] - x, at[1] - y, at[2] - z));
        const key = `${i},${k}`;
        nodes.set(key, [...(nodes.get(key) ?? []), [x, y, z]]);
      }
      for (const meeting of nodes.values())
        for (const a of meeting)
          for (const b of meeting) seam = Math.max(seam, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
    }
    assert.ok(worst < 0.03, `a tile corner is ${worst.toFixed(3)} m off its point`);
    assert.ok(seam < 0.06, `two neighbouring corners are ${seam.toFixed(3)} m apart`);
  });
