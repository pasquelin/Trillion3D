import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { exampleModules } from './docs/examples/capture.ts';
import { geometry, light, material, math, object } from '../packages/sdk-browser/src/index.ts';
import { WaterSurface } from '../packages/sdk-core/src/fluids/waterSurface.ts';
import type { WaterSpec } from '../packages/sdk-core/src/fluids/buoyancy.ts';
import type { Object3D } from '../packages/sdk-core/src/world/object/object3d.ts';
import { seeded } from '../site/examples/kit/random.ts';
import { roadmapEntries } from '../site/app/examples/list.ts';

type Hook = () => void;
type Spec = unknown[] | boolean | (() => void);

/**
 * Runs an example page's module in Node on the engine's own scene objects, with a world that
 * counts the shapes its scene writes to the runtime (`content`). A written shape is cut again and
 * opens the session again (docs/SDK.md, "Live material values"): a page that writes one every
 * frame never keeps a session long enough to draw, the blank render of #522.
 */
async function countShapeWrites(html: string) {
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
  /** Runs one frame at `seconds` and returns the shape writes it told the runtime. */
  return (seconds: number) => {
    const before = told.content;
    time = seconds;
    for (const hook of frames) hook();
    return told.content - before;
  };
}

test('the shape-write counter counts a rewritten shape and not a moved object', async () => {
  const frame = await countShapeWrites(`<script type="module">
    import { createWorld, geometry, material, object } from '../runtime/engine.js';
    const world = createWorld('view');
    const sheet = geometry.plane(1, 1, 2, 2);
    const mesh = object.mesh(sheet, material.meshStandard({}));
    world.scene.add(mesh);
    let n = 0;
    world.onFrame(() => {
      n++;
      mesh.position.set(n, 0, 0);
      if (n % 2) {
        sheet.attributes.position.setXYZ(0, 0, n, 0);
        sheet.attributes.position.needsUpdate = true;
      }
    });
  </script>`);
  assert.deepEqual([0.1, 0.2, 0.3, 0.4].map(frame), [1, 0, 1, 0]);
});

// #573's acceptance: skipped while the roadmap parks floating crates on it, run once unparked.
const crates = roadmapEntries.find(({ id }) => id === 'floating-crates');
const parked = crates?.status === 'waiting-engine' && `waits for #${crates.issue}`;
test('floating crates writes no shape per frame', { skip: parked }, async () => {
  assert.ok(crates, 'the roadmap has no floating-crates entry');
  const html = await readFile(new URL(`../site/${crates.file}`, import.meta.url), 'utf8');
  const frame = await countShapeWrites(html);
  assert.deepEqual([0.1, 0.2, 0.3].map(frame), [0, 0, 0]);
});
