// #966 (from #558): `castShadow = false` reaches the far sun field. A source node of the proxy casts
// none when every mesh it draws itself says so — itself, or its primitive parts, never a child node
// of its own rank —, read once per scene revision; the proxy is marked again only on a change.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts';
import { object } from '../../../../../sdk-core/src/world/object/index.ts';
import { geometry } from '../../../../../sdk-core/src/world/geometry/index.ts';
import {
  registerPlacedMeshRank,
  registerPreparedNodeRank,
} from '../../../host/prepared/sourceRanks.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import { syncSunFarCasters } from './sunFarCasters.ts';

const mesh = () => object.mesh(geometry.box(1, 1, 1));

test('the far sun lets through the sources whose every drawn mesh casts none', () => {
  // Rank 0 a mesh; rank 1 a group of two parts; rank 2 a group of one part and a child of rank 3.
  const [single, left, right, part, child] = [0, 1, 2, 3, 4].map(mesh);
  const pair = new Group().add(left, right),
    parent = new Group().add(part, child);
  const source = new Object3D().add(single, pair, parent);
  [single, pair, parent, child].forEach((node, rank) => registerPreparedNodeRank(node, rank));
  const marked: number[][] = [];
  const proxy = {
    castless: (none: (source: number, mesh: number) => boolean) =>
      void marked.push([0, 1, 2, 3].filter((source) => none(source, -1))),
  };
  const rt = {
    setup: { source },
    run: { gate: { revisions: { scene: 1 } } },
    sunFar: { gpu: { proxy } },
  } as unknown as WebgpuPagesRuntime;
  const frame = (moved = true) => {
    if (moved) rt.run.gate.revisions.scene++;
    syncSunFarCasters(rt);
  };
  frame();
  assert.deepEqual(marked, [], 'every mesh casts: the proxy is left as built');
  left.castShadow = false;
  frame();
  assert.deepEqual(marked, [], 'one part of two still casts');
  right.castShadow = part.castShadow = single.castShadow = false;
  frame(false);
  assert.deepEqual(marked, [], 'read once per scene revision');
  frame();
  assert.deepEqual(marked, [[0, 1, 2]], "a child node's own mesh is not its parent's part");
  frame();
  assert.equal(marked.length, 1, 'unchanged flags mark nothing again');
  single.castShadow = true;
  frame();
  assert.deepEqual(marked.at(-1), [1, 2]);
});

test("a partition's cell node, which the host does not hold, casts as its placed mesh's parts", () => {
  // Rank 0 a core node placing mesh 4; ranks 5 and 6 cell nodes of mesh 4, rank 7 of mesh 8, which
  // no cell places; mesh 4 is drawn by two placed parts (one per primitive).
  const core = mesh(),
    parts = [mesh(), mesh()];
  const source = new Object3D().add(core, ...parts);
  registerPreparedNodeRank(core, 0);
  parts.forEach((part) => registerPlacedMeshRank(part, 4));
  const meshOf = new Map([
    [0, 4],
    [5, 4],
    [6, 4],
    [7, 8],
  ]);
  const marked: number[][] = [];
  const proxy = {
    castless: (none: (source: number, mesh: number) => boolean) =>
      void marked.push([...meshOf].filter(([s, m]) => none(s, m)).map(([s]) => s)),
  };
  const rt = {
    setup: { source },
    run: { gate: { revisions: { scene: 1 } } },
    sunFar: { gpu: { proxy } },
  } as unknown as WebgpuPagesRuntime;
  const frame = () => {
    rt.run.gate.revisions.scene++;
    syncSunFarCasters(rt);
  };
  parts[0].castShadow = false;
  frame();
  assert.deepEqual(marked, [], 'one part of the placed mesh still casts');
  parts[1].castShadow = false;
  frame();
  assert.deepEqual(marked, [[5, 6]], 'the core node of the same mesh casts as its own mesh says');
  core.castShadow = false;
  frame();
  assert.deepEqual(marked.at(-1), [0, 5, 6], 'a mesh no cell places keeps its cell node casting');
  parts[1].castShadow = true;
  frame();
  assert.deepEqual(marked.at(-1), [0]);
});
