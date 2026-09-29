import test from 'node:test';
import assert from 'node:assert/strict';
import { bindSkins, clipsOf } from './motion.ts';
import { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts';
import { Group } from '../../../../sdk-core/src/world/object/object3d.ts';
import type { PreparedSceneTables } from '../../../../sdk-core/src/scene/core/tableContracts.ts';

test('parent skin and morph tracks stop at child source nodes in either source order', () => {
  for (const childFirst of [true, false]) {
    const child = new Mesh(),
      parent = new Group(),
      partA = new Mesh(),
      partB = new Mesh();
    const boneA = new Group(),
      boneB = new Group(),
      wrapper = new Group();
    child.name = 'child';
    partA.name = 'partA';
    partB.name = 'partB';
    parent.add(partA, wrapper.add(partB), child);
    const nodes = childFirst ? [child, parent, boneA, boneB] : [parent, child, boneA, boneB];
    const tables = {
      skins: [
        { joints: [2], inverseBindMatrices: null },
        { joints: [3], inverseBindMatrices: null },
      ],
      nodes: nodes.map((node) => ({ skin: node === parent ? 0 : node === child ? 1 : null })),
      animations: [
        {
          name: 'parent-morph',
          channels: [
            {
              node: nodes.indexOf(parent),
              path: 'weights',
              times: [0, 1],
              values: [0, 1],
              interpolation: 'LINEAR',
            },
          ],
        },
      ],
    } as unknown as PreparedSceneTables;
    bindSkins(tables, nodes);
    assert.equal(child.skeleton?.bones[0], boneB);
    assert.equal(partA.skeleton?.bones[0], boneA);
    assert.equal(partB.skeleton?.bones[0], boneA);
    assert.deepEqual(
      clipsOf(tables, nodes)[0].tracks.map((track) => track.name),
      ['partA.morphTargetInfluences', 'partB.morphTargetInfluences'],
    );
  }
});
