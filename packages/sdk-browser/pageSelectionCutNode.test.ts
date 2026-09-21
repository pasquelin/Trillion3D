// Lot 4c: at threshold zero, a node's decision is taken on the bounds alone, without projecting.
// It matches the general path only under the invariant `cullingBounds` maintains — a finite
// strictly positive bound always comes from a cluster that had its sphere — and the second
// test proves that. Oracle: `nodeDecision` from before the lot, in `bench/oracles/coupe-budget.ts`.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { nodeDecision, nodeDecisionAtZero } from './pageSelectionCutNode.ts';
import {
  BOUND_STRIDE,
  OWN_CEIL,
  OWN_FLOOR,
  OWN_SPHERE,
  PARENT_FLOOR,
  PARENT_SPHERE,
  cullingBounds,
} from './pageSelectionCutBounds.ts';
import type { PageRecord, SelectionState } from './pageSelectionCutState.ts';
import { referenceNodeDecision } from './bench/oracles/coupe-budget.ts';
import { cameraMoteur } from './cameraFixture.ts';

const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.25, 500);
camera.position.set(3, 2, 9);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld();
const view = camera.matrixWorldInverse.elements;
const STRETCH = 1.25,
  FOCAL = 640;
const SLOTS = {
  ownFloor: OWN_FLOOR,
  ownCeil: OWN_CEIL,
  parentFloor: PARENT_FLOOR,
  ownSphere: OWN_SPHERE,
  parentSphere: PARENT_SPHERE,
};
const state = {
  pixelError: 0,
  flatElements: view,
  flatStretch: STRETCH,
  flatFocal: FOCAL,
  cam: cameraMoteur(camera),
} as unknown as SelectionState<PageRecord>;

const ABSENTE = [0, 0, 0, -1];
const PROCHE = [0, 0, 20, 2],
  LOIN = [-40, 5, 90, 30];

/** A finite strictly positive bound requires its sphere: that is what preparation guarantees. */
function coherente(bound: number, sphere: number[]) {
  return !(bound > 0 && bound !== Infinity) || sphere[3] >= 0;
}

test('at threshold zero, the node decision without projection matches the general path', () => {
  let vus = 0;
  for (const floor of [0, 1e-6, 3, Infinity])
    for (const ceil of [0, 1e-6, 3, Infinity])
      for (const parentFloor of [0, 1e-6, 3, Infinity])
        for (const own of [PROCHE, LOIN, ABSENTE])
          for (const band of [PROCHE, LOIN, ABSENTE]) {
            // The ceiling bounds the floor by construction: a node whose floor exceeds its
            // ceiling never leaves `cullingBounds`.
            if (floor > ceil) continue;
            if (!coherente(floor, own) || !coherente(ceil, own) || !coherente(parentFloor, band))
              continue;
            vus++;
            const values = new Float64Array(BOUND_STRIDE);
            values[OWN_FLOOR] = floor;
            values[OWN_CEIL] = ceil;
            values[PARENT_FLOOR] = parentFloor;
            for (let a = 0; a < 4; a++) values[OWN_SPHERE + a] = own[a];
            for (let a = 0; a < 4; a++) values[PARENT_SPHERE + a] = band[a];
            const reference = referenceNodeDecision(
              values,
              0,
              SLOTS,
              view,
              STRETCH,
              FOCAL,
              camera.near,
              0,
            );
            assert.equal(nodeDecision(state, values, 0), reference, `general ${floor}/${ceil}`);
            assert.equal(
              nodeDecisionAtZero(values, 0),
              reference,
              `zero threshold ${floor}/${ceil}`,
            );
          }
  assert.ok(vus > 50, `only ${vus} coherent nodes`);
});

/** Clusters preparation can produce, plus those it leaves without an error band. */
function pages(): PageRecord[] {
  const out: PageRecord[] = [];
  for (const lodError of [0, 1e-6, 2, undefined])
    for (const parentError of [null, 0, 3, Infinity])
      for (const sphere of [PROCHE, LOIN])
        out.push({
          triangles: 1,
          min: [-1, -1, -1],
          max: [1, 1, 1],
          lodError,
          sphere: lodError === undefined ? undefined : sphere,
          parentError: parentError === 0 && lodError !== 0 ? null : parentError,
          parentSphere: parentError === null ? null : sphere,
        });
  return out;
}

test('a finite positive node bound always comes from a cluster that had its sphere', () => {
  const all = pages();
  // A two-level hierarchy: the root, then four leaves that share the clusters.
  const stride = 15,
    count = 5;
  const nodes = new Float64Array(count * stride);
  const perLeaf = Math.ceil(all.length / 4);
  nodes[11] = 1;
  nodes[12] = 4;
  for (let leaf = 0; leaf < 4; leaf++) {
    const base = (leaf + 1) * stride;
    nodes[base + 13] = leaf * perLeaf;
    nodes[base + 14] = Math.min(perLeaf, Math.max(0, all.length - leaf * perLeaf));
  }
  const values = cullingBounds({ nodes, stride }, all);
  for (let node = 0; node < count; node++) {
    const at = node * BOUND_STRIDE;
    const own = [0, 0, 0, values[at + OWN_SPHERE + 3]],
      band = [0, 0, 0, values[at + PARENT_SPHERE + 3]];
    assert.ok(coherente(values[at + OWN_FLOOR], own), `own floor of node ${node}`);
    assert.ok(coherente(values[at + OWN_CEIL], own), `own ceiling of node ${node}`);
    assert.ok(coherente(values[at + PARENT_FLOOR], band), `replacement floor, node ${node}`);
  }
});
