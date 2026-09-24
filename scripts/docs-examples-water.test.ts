import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { exampleModules } from './docs/examples/capture.ts';
import { geometry, light, material, math, object } from '../packages/sdk-browser/src/index.ts';
import { WaterSurface } from '../packages/sdk-core/src/fluids/waterSurface.ts';
import type { WaterSpec } from '../packages/sdk-core/src/fluids/buoyancy.ts';
import type { Object3D } from '../packages/sdk-core/src/world/object/object3d.ts';
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
  const told = { content: 0 };
  const scene = object.group();
  scene._link = {
    pose: () => {},
    posed: () => {},
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
  // The kit's panel, without a document: its values at their defaults, told once.
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
    frame(seconds: number) {
      time = seconds;
      for (const hook of frames) hook();
    },
  };
}

// The acceptance check of #573: today every frame of the page rewrites its sheet, and every write
// cuts the shape again (the blank render of #522, parked until then). When #573 uploads a shape
// written each frame in place, the runtime is told no `content` per frame: this test then asserts 0.
test('floating crates writes its water sheet every frame until #573 uploads it in place', async () => {
  const page = await floatingCrates();
  page.frame(0);
  page.told.content = 0;
  for (const seconds of [0.1, 0.2, 0.3]) page.frame(seconds);
  assert.ok(page.told.content >= 3, `${page.told.content} writes in 3 frames: at least one each`);
});
