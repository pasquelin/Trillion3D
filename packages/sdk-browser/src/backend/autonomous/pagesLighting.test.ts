// #297: the autonomous WebGL2 path lights from the cache's light table, radiometric as
// `lights.json` records it, and not from the photometric intensities the source graph carries.
// Lit by the source graph alone — 2400 lux for this sun — the image comes out flat white.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { autonomousPagesBackend } from './pages.ts';
import { createSceneLightStore, type ClusterManifest } from '../../../../sdk-core/src/index.ts';
import {
  createWorldNotices,
  listenWorldNotices,
  noticeShadowRefusal,
} from '../../world/diagnostic/worldNotices.ts';

/** Radiometric irradiance of the contract, `2400 / 683 lm·W⁻¹`. */
const RADIOMETRIC = 3.514;
const PHOTOMETRIC = 2400;

const metadata = {
  errorModel: 'dag-group-qem-v2',
  clusterStrategy: 'dag-groups',
  geometryPages: { formatVersion: 3 as const, codec: 'quantized' as const },
  primitives: [],
} as unknown as ClusterManifest;

test('the autonomous path lights from the contract table, not from the source graph', () => {
  const source = new G.Group();
  source.add(G.directionalLight(0xffffff, PHOTOMETRIC));
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
    const shown = (object: G.Object3D): boolean =>
      object.visible && (!object.parent || shown(object.parent));
    const lit: number[] = [];
    (backend.scene as G.GraphScene).traverse((object) => {
      if (G.isLightNode(object) && shown(object)) lit.push((object as G.GraphLight).intensity);
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

// #558 (D): the WebGL2 path draws no shadow map. A light that asks to cast is drawn unshadowed
// and named on the world's channel as `shadows-refused`, once until its `castShadow` changes;
// a light that casts none is never named.
test('a casting light on the WebGL2 path is named once, never silently unshadowed', async () => {
  const sceneLights = createSceneLightStore();
  const lamp = (id: string, castsShadow: boolean) =>
    sceneLights.add({
      id,
      kind: 'point',
      position: [0, 2, 0],
      range: 8,
      color: [1, 1, 1],
      intensity: 5,
      castsShadow,
    });
  lamp('lamp', true);
  lamp('bulb', false);
  const notices = createWorldNotices();
  const said: string[] = [];
  const stop = listenWorldNotices((n) => void said.push(`${n.phase} ${n.context.light}`));
  const backend = autonomousPagesBackend({
    source: new G.Group(),
    metadata,
    indices: new Map(),
    associations: new Map(),
    sceneLights,
    shadowsRefused: noticeShadowRefusal(notices),
    readGeometryPage: async () => new Uint8Array(),
  });
  const refresh = () => backend.refreshSceneLights!();
  try {
    sceneLights.set('lamp', { intensity: 6 });
    refresh(); // a change of the lights that leaves the cast alone says nothing again
    sceneLights.set('lamp', { castsShadow: false });
    refresh();
    sceneLights.set('lamp', { castsShadow: true });
    refresh(); // off then on again: named anew
    await new Promise(setImmediate);
    assert.deepEqual(said, ['shadows-refused lamp', 'shadows-refused lamp']);
    assert.equal(backend.lighting?.shadows, false, 'the capability still says no shadow');
  } finally {
    stop();
    notices.close();
    backend.dispose();
  }
});
