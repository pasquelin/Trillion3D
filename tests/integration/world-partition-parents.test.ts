// A page moves the parent of placed nodes (#404). The synthetic world of `world-partition.test.ts`
// hangs every placement under one scene root, `district`, and is compiled by this checkout's
// native compiler: the cells box their nodes in the district's frame. A page loads it as a world
// does (`loadModel`), finds the district by name (`getObjectByName`) and moves it 5 km, to where a
// still camera stands. The session's per-frame step (`createPartitionFrame`) then reads the cells
// there: every node within the camera's reach is drawn, on a row at its moved place.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Object3D } from '../../packages/sdk-core/src/world/object/object3d.ts';
import type { RenderBackend } from '../../packages/sdk-browser/src/backend/types.ts';
import { hostFramingCamera } from '../../packages/sdk-browser/src/host/scene/graphObjects.ts';
import type { PlacementRows } from '../../packages/sdk-browser/src/placement/rows.ts';
import { cellReach } from '../../packages/sdk-browser/src/scene/partition/plan.ts';
import { createPageStreamer } from '../../packages/sdk-browser/src/streaming/pages.ts';
import { loadModel } from '../../packages/sdk-browser/src/world/core/loadedModel.ts';
import { createWorldPoses } from '../../packages/sdk-browser/src/world/core/worldPoses.ts';
import {
  createPartitionFrame,
  primePartitions,
} from '../../packages/sdk-browser/src/world/scene/partitionFrame.ts';
import { compiled, compiler, machine, SPACING, world } from './world-partition.fixture.ts';

const SHIFT = 5000;

test(
  'a page that moves the parent of placed nodes moves their cells: none is missing, camera still',
  { skip: !existsSync(compiler) },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'world-partition-parents-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const pointer = await compiled(root, world(96, 'district'));
    machine(t, pointer);
    const model = await loadModel(pointer.href, { textureSource: 'host', scope: 'full' });
    const [cells] = model.record.scene.partitions;
    const streamer = createPageStreamer(cells.pages, model.record.base);
    // The camera stands where the middle of the district will be, 5 km from where it is.
    const camera = hostFramingCamera(60, 16 / 9, 0.1, 300);
    const eye = [48 * SPACING - SHIFT, 2, 48 * SPACING];
    camera.position.set(eye[0], eye[1], eye[2]);
    camera.updateMatrixWorld();
    await primePartitions([cells], camera, streamer, true);
    assert.equal(cells.stats().held, 0, 'nothing is there yet');

    const scene = new Object3D();
    scene.add(model);
    const district = model.getObjectByName('district')!;
    district.position.x -= SHIFT;
    const poses = createWorldPoses();
    poses.moved(district);
    poses.apply(scene, new Map(), new Map(), () => {});

    const written = new Set<PlacementRows>();
    let renewed = 0;
    const frame = createPartitionFrame({
      partitions: [cells],
      streamer,
      camera,
      active: () => ({ updatePlacements: (rows) => void written.add(rows) }) as RenderBackend,
      renew: () => void renewed++,
    })!;
    for (let step = 0; step < 16; step++) {
      frame();
      if (!(await frame.pending())) break;
    }
    const { held, waiting } = cells.stats();
    assert.ok(held > 0 && waiting === 0 && renewed === 0, JSON.stringify({ held, renewed }));

    // Every node within reach of the still camera has a live row at its moved place.
    const drawn = new Set<string>();
    const key = (x: number, z: number) => `${Math.round(x * 1e3)},${Math.round(z * 1e3)}`;
    for (const rows of written)
      for (let row = 0; row < rows.capacity; row++)
        if (rows.live[row])
          drawn.add(key(rows.matrices[row * 16 + 12], rows.matrices[row * 16 + 14]));
    const reach = cellReach(camera);
    let near = 0;
    for (const { url } of cells.pages) {
      const body = JSON.parse(await readFile(fileURLToPath(url), 'utf8'));
      for (const {
        translation: [x, y, z],
      } of body.nodes) {
        const at = [x - SHIFT, y, z];
        if (Math.hypot(at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]) > reach) continue;
        near++;
        assert.ok(drawn.has(key(at[0], at[2])), `the node at ${at} is drawn`);
      }
    }
    assert.ok(near > 100, `${near} nodes within reach`);
  },
);
