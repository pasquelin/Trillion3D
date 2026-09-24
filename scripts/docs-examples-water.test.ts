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
async function floatingCrates() {
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
  // The kit's panel, without a document: its values at their defaults, told once at start.
  const controls = (specs: Record<string, Spec>, onChange: (values: object) => void) => {
    const values = Object.fromEntries(
      Object.entries(specs)
        .filter(([, spec]) => typeof spec !== 'function')
        .map(([key, spec]) => [key, Array.isArray(spec) ? spec[2] : spec]),
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

test('floating crates tiles its water on the waves: every tile corner lies on the surface', async () => {
  const page = await floatingCrates();
  page.frame(1.7);
  const surface = page.surface();
  page.scene.updateMatrixWorld();
  const tiles = page.scene.children.filter((node) => (node as Mesh).material?.transparent);
  assert.ok(tiles.length > 100, 'the water is drawn as tiles');
  const corner = math.vector3(),
    at = new Float64Array(3);
  let worst = 0;
  for (const tile of tiles as Mesh[]) {
    const box = tile.geometry.computeBoundingBox()!;
    for (const x of [box.min.x, box.max.x])
      for (const z of [box.min.z, box.max.z]) {
        tile.localToWorld(corner.set(x, 0, z));
        // The rest point the waves carry onto this corner, found by walking back their offset.
        let restX = corner.x,
          restZ = corner.z;
        for (let step = 0; step < 8; step++) {
          surface.point(restX, restZ, at);
          restX -= at[0] - corner.x;
          restZ -= at[2] - corner.z;
        }
        surface.point(restX, restZ, at);
        worst = Math.max(worst, Math.hypot(at[0] - corner.x, at[1] - corner.y, at[2] - corner.z));
      }
  }
  assert.ok(worst < 0.03, `a tile corner is ${worst.toFixed(3)} m off the waves`);
});
