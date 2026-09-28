// #297: the autonomous WebGL2 path lights from the cache's light table, radiometric as
// `lights.json` records it, and not from the photometric intensities the source graph carries.
// Lit by the source graph alone — 2400 lux for this sun — the image comes out flat white.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { autonomousPagesBackend } from './pages.ts';
import { DAG } from '../pagesBackend.fixture.ts';
import { createSceneLightStore, type ClusterManifest } from '../../../../sdk-core/src/index.ts';
import { Light } from '../../../../sdk-core/src/world/light/light.ts';
import { lampRecord } from '../../../../sdk-core/src/world/light/lightRecord.ts';
import {
  createWorldNotices,
  listenWorldNotices,
  noticeShadowRefusal,
} from '../../world/diagnostic/worldNotices.ts';

/** Radiometric irradiance of the contract, `2400 / 683 lm·W⁻¹`. */
const RADIOMETRIC = 3.514;
const PHOTOMETRIC = 2400;

const metadata = {
  ...DAG,
  geometryPages: { formatVersion: 4 as const, codec: 'quantized' as const },
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
    (backend.scene as G.Scene).traverse((object) => {
      if (G.isLightNode(object) && shown(object)) lit.push(object.intensity);
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

// #558 (D): the WebGL2 path draws no shadow map. A light that asks to cast — the sun, a point
// lamp or a spot — is drawn unshadowed and named on the world's channel as `shadows-refused`,
// once until it changes; a light that casts none is never named.

/** A WebGL2 engine on `source` and `sceneLights`, and what its world said since the last call. */
function webgl2(source: G.Object3D, sceneLights = createSceneLightStore()) {
  const notices = createWorldNotices();
  const said: string[] = [];
  const stop = listenWorldNotices((n) => void said.push(`${n.phase} ${n.context.light}`));
  const backend = autonomousPagesBackend({
    source,
    metadata,
    indices: new Map(),
    associations: new Map(),
    sceneLights,
    shadowsRefused: noticeShadowRefusal(notices),
    readGeometryPage: async () => new Uint8Array(),
  });
  const heard = async (refresh: () => void = () => {}) => {
    refresh();
    await new Promise(setImmediate);
    return said.splice(0).sort();
  };
  const close = () => {
    stop();
    notices.close();
    backend.dispose();
  };
  return { backend, heard, close };
}

// The lights are the page's, made store records as the world makes them (`lampRecord`).
test('every casting contract light on the WebGL2 path is named once, never silently', async () => {
  const sceneLights = createSceneLightStore();
  const page = {
    sun: new Light('directional', { castShadow: true, intensity: 3, target: [0, -1, 0] }),
    lamp: new Light('point', { castShadow: true, position: [0, 2, 0], distance: 8 }),
    spot: new Light('spot', { castShadow: true, position: [0, 4, 0], target: [0, 0, 0] }),
    bulb: new Light('point', { position: [2, 2, 0], distance: 8 }),
  };
  const record = (id: keyof typeof page) => lampRecord(page[id], id, 10)!;
  for (const id of Object.keys(page) as (keyof typeof page)[]) sceneLights.add(record(id));
  const { backend, heard, close } = webgl2(new G.Group(), sceneLights);
  const apply = () => backend.refreshSceneLights!();
  try {
    const casting = ['shadows-refused lamp', 'shadows-refused spot', 'shadows-refused sun'];
    assert.deepEqual(await heard(), casting);
    sceneLights.set('sun', { intensity: 6 });
    assert.deepEqual(await heard(apply), [], 'a change that keeps the cast says nothing again');
    page.sun.castShadow = false;
    sceneLights.set('sun', record('sun'));
    sceneLights.remove('spot');
    assert.deepEqual(await heard(apply), []);
    page.sun.castShadow = true;
    sceneLights.set('sun', record('sun'));
    sceneLights.add(record('spot'));
    assert.deepEqual(await heard(apply), ['shadows-refused spot', 'shadows-refused sun']);
    assert.equal(backend.lighting?.shadows, false, 'the capability still says no shadow');
  } finally {
    close();
  }
});

// With no contract light, the source graph lights, and its casting lights are named the same.
test('a casting source-graph light on the WebGL2 path is named, until the contract lights', async () => {
  const sun = G.directionalLight();
  sun.name = 'sun';
  sun.castShadow = true;
  const source = new G.Group();
  source.add(sun, G.pointLight());
  const sceneLights = createSceneLightStore();
  const { backend, heard, close } = webgl2(source, sceneLights);
  const copy = () => backend.refreshSceneLighting!();
  try {
    assert.deepEqual(await heard(), ['shadows-refused sun']);
    sun.castShadow = false;
    assert.deepEqual(await heard(copy), []);
    sun.castShadow = true;
    assert.deepEqual(await heard(copy), ['shadows-refused sun'], 'casting anew, named anew');
    const lamp = new Light('point', { castShadow: true, distance: 8 });
    sceneLights.add(lampRecord(lamp, 'lamp', 10)!);
    const governed = await heard(() => backend.refreshSceneLights!());
    assert.deepEqual(governed, ['shadows-refused lamp'], 'the source graph no longer lights');
  } finally {
    close();
  }
});
