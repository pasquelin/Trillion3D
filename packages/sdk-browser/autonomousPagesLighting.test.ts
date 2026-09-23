// #297: the autonomous WebGL2 path lights from the cache's light table, radiometric as
// `lights.json` records it, and not from the photometric intensities the source graph carries.
// Lit by the source graph alone — 2400 lux for this sun — the image comes out flat white.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { autonomousPagesBackend } from './autonomousPages.ts';
import { createSceneLightStore, type ClusterManifest } from '../sdk-core/src/index.ts';

/** Radiometric irradiance of the contract, `2400 / 683 lm·W⁻¹`. */
const RADIOMETRIC = 3.514;
const PHOTOMETRIC = 2400;

test('the autonomous path lights from the contract table, not from the source graph', () => {
  const metadata = {
    errorModel: 'dag-group-qem-v1',
    clusterStrategy: 'dag-groups',
    geometryPages: { formatVersion: 3 as const, codec: 'quantized' as const },
    primitives: [],
  } as unknown as ClusterManifest;
  const source = new THREE.Group();
  source.add(new THREE.DirectionalLight(0xffffff, PHOTOMETRIC));
  const sceneLights = createSceneLightStore();
  sceneLights.add({
    id: 'sun',
    kind: 'directional',
    color: [1, 1, 1],
    intensity: RADIOMETRIC,
    direction: [0, -1, 0],
    castsShadow: false,
  });
  const backend = autonomousPagesBackend({
    source,
    metadata,
    indices: new Map(),
    associations: new Map(),
    sceneLights,
    readGeometryPage: async () => new Uint8Array(),
  });
  try {
    const shown = (object: THREE.Object3D): boolean =>
      object.visible && (!object.parent || shown(object.parent));
    const lit: number[] = [];
    (backend.scene as THREE.Scene).traverse((object) => {
      if ((object as THREE.Light).isLight && shown(object))
        lit.push((object as THREE.Light).intensity);
    });
    // The contract governs: the source-graph copy is switched off, and no intensity of the
    // glTF's photometric scale reaches the renderer.
    assert.deepEqual(lit, [RADIOMETRIC]);
    assert.equal(backend.sceneLit?.(), true);
    assert.equal(backend.lighting?.shadows, false);
  } finally {
    backend.dispose();
  }
});
