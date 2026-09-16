// Lot 4c : à seuil nul, la décision d'un nœud se prend sur les seules bornes, sans projeter. Elle
// n'est identique au chemin général que sous l'invariant que `cullingBounds` maintient — une borne
// finie strictement positive vient toujours d'un cluster qui avait sa sphère —, et c'est le second
// test qui le prouve. Oracle : `nodeDecision` d'avant le lot, dans `bench/oracles/coupe4c.mjs`.
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
import { referenceNodeDecision } from './bench/oracles/coupe4c.mjs';
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

/** Une borne finie strictement positive impose sa sphère : c'est ce que la préparation garantit. */
function coherente(bound: number, sphere: number[]) {
  return !(bound > 0 && bound !== Infinity) || sphere[3] >= 0;
}

test('à seuil nul, la décision de nœud sans projection est celle du chemin général', () => {
  let vus = 0;
  for (const floor of [0, 1e-6, 3, Infinity])
    for (const ceil of [0, 1e-6, 3, Infinity])
      for (const parentFloor of [0, 1e-6, 3, Infinity])
        for (const own of [PROCHE, LOIN, ABSENTE])
          for (const band of [PROCHE, LOIN, ABSENTE]) {
            // Le plafond borne le plancher par construction : un nœud dont le plancher dépasse son
            // plafond ne sort jamais de `cullingBounds`.
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
            assert.equal(nodeDecision(state, values, 0), reference, `général ${floor}/${ceil}`);
            assert.equal(nodeDecisionAtZero(values, 0), reference, `seuil nul ${floor}/${ceil}`);
          }
  assert.ok(vus > 50, `seulement ${vus} nœuds cohérents`);
});

/** Les clusters que la préparation peut produire, plus ceux qu'elle laisse sans bande d'erreur. */
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

test('une borne de nœud finie et positive vient toujours d’un cluster qui avait sa sphère', () => {
  const all = pages();
  // Une hiérarchie à deux niveaux : la racine, puis quatre feuilles qui se partagent les clusters.
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
    assert.ok(coherente(values[at + OWN_FLOOR], own), `plancher propre du nœud ${node}`);
    assert.ok(coherente(values[at + OWN_CEIL], own), `plafond propre du nœud ${node}`);
    assert.ok(coherente(values[at + PARENT_FLOOR], band), `plancher du remplaçant, nœud ${node}`);
  }
});
