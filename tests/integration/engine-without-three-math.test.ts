import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PUBLIC_FAMILIES } from './engine-without-three-lists.ts';

const browser = new URL('../../packages/sdk-browser/src/', import.meta.url);

// COMPUTATION BOUNDARY OF LOADING AND EXPLORER (M4a batch).
// Engine numbers are computed by `sdk-core`, never by the host 3D library: same formulas,
// same float operation order, flat buffers, no allocations per frame. What the host OWNS remains its own
// (scene, camera, materials), and engine can no longer COMPUTE using it: recomposing world matrix,
// box transformation, position extraction, inversion, decomposition. It also no longer READS world matrices
// composed by host: engine's come from local poses (`packages/sdk-browser/src/host/world/chain.ts`, `packages/sdk-browser/src/host/world/tree.ts`, `packages/sdk-browser/src/host/world/placements.ts`),
// and the only remaining update serves host scene. Every line keeping a computation is named here with its rationale.

/** Batch files: scene loading, explorer, and their contracts. */
const M4A = [
  'backend/awaitBackendPages',
  'backend/common',
  'backend/types',
  'backend/exact/bounds',
  'world/session/backends',
  'world/camera/camera',
  'world/api/cameraApi',
  'world/session/capabilities',
  'world/capture/capture',
  'world/session/disposeSource',
  'world/render/draw',
  'world/render/hostState',
  'world/session/lifecycle',
  'world/session/options',
  'world/session/prepare',
  'world/render/render',
  'world/render/fallback',
  'world/scene/scene',
  'world/api/sceneApi',
  'world/api/viewportApi',
  'host/scene/graphObjects',
  'host/scene/hookCore',
  'host/scene/hooks',
  'host/scene/scan',
  'host/scene/watch',
  'host/world/bounds',
  'host/world/chain',
  'host/world/matrices',
  'host/world/placements',
  'host/world/pose',
  'host/world/tree',
  'page/selection/collect',
  'page/selection/helpers',
  'backend/pagesBackendScenes.fixture',
  'scene/replicateInstances',
  'scene/meshes',
  'webgpu/core/geometryPrepare',
  'webgpu/pages/prepare/prepare',
  'webgpu/pages/prepare/setup',
  'webgpu/frame/presentationSetup',
].map((nom) => `${nom}.ts`);

/** Host library COMPUTATION methods and constructors, replaced by core. */
const CALCULS = [
  '.updateMatrixWorld(',
  '.updateWorldMatrix(',
  '.multiplyMatrices(',
  '.applyMatrix4(',
  '.getWorldPosition(',
  '.getWorldQuaternion(',
  '.getBoundingSphere(',
  '.setFromProjectionMatrix(',
  '.invert(',
  '.determinant(',
  '.decompose(',
  '.compose(',
  '.getNormalMatrix(',
  '.setFromMatrixPosition(',
  'new THREE.Matrix4',
  'new THREE.Vector3',
  'new THREE.Box3',
  'new THREE.Sphere',
];

/** File -> exact line -> why this line is a host boundary and not a computation. */
const FRONTIERE: Record<string, Record<string, string>> = {
  'host/world/matrices.ts': {
    'node.updateMatrixWorld(true);':
      'the scene belongs to the host: it stays up to date FOR IT, and the engine no longer reads it',
  },
  'world/camera/camera.ts': {
    'camera.updateMatrixWorld();': 'the host SETS its camera; the written pose is resolved once',
  },
  'host/scene/graphObjects.ts': {
    'new THREE.Box3(':
      '`explorer.bounds` is returned to the host: the bench computes its trajectory from it',
    'new THREE.Vector3(flat[0], flat[1], flat[2]),': 'low bound of this box returned to the host',
    'new THREE.Vector3(flat[3], flat[4], flat[5]),': 'high bound of this box returned to the host',
    'new THREE.Vector3(x, y, z);':
      '`explorer.center` and the home offset, returned to the host whose controls aim at them',
  },
  'world/api/cameraApi.ts': {
    'camera.updateMatrixWorld();': 'return to the home pose: the host camera, reset',
  },
  'world/render/hostState.ts': {
    'camera.updateMatrixWorld();': 'the host restores a recorded pose into its camera',
  },
  'world/api/viewportApi.ts': {
    'view.updateMatrixWorld();': 'the capture view is a host camera, set then resolved',
  },
};

/** Lines triggering a pattern, comments excluded. */
const lignesFautives = (texte: string): string[] =>
  texte
    .split('\n')
    .filter((ligne) => !/^\s*(?:\/\/|\*|\/\*)/.test(ligne))
    .map((ligne) => ligne.trim())
    .filter((ligne) => CALCULS.some((motif) => ligne.includes(motif)));

test('loading and explorer no longer compute using the host library', async () => {
  const fuites: string[] = [],
    inutiles: string[] = [];
  for (const file of M4A) {
    const texte = await readFile(new URL(file, browser), 'utf8');
    const permis = FRONTIERE[file] ?? {},
      vues = new Set<string>();
    for (const ligne of lignesFautives(texte)) {
      if (permis[ligne]) vues.add(ligne);
      else fuites.push(`${file} computes through the host library: ${ligne}`);
    }
    for (const ligne of Object.keys(permis))
      if (!vues.has(ligne))
        inutiles.push(`${file} declares a boundary that no longer exists: ${ligne}`);
  }
  assert.deepEqual(fuites, [], `boundary declared in ${import.meta.url}`);
  assert.deepEqual(inutiles, [], 'a vanished boundary is removed from the list');
});

test('each file in M4a batch still exists under its name', async () => {
  for (const file of M4A)
    await assert.doesNotReject(
      readFile(new URL(file, browser), 'utf8'),
      `${file} was renamed or deleted: the M4a lot list must follow`,
    );
});

// PAGE MATRIX IS COPIED, NEVER COMPUTED.
// `PageRec.matrix` and `ClusterRoot.world` are host library matrices filled by ENGINE (`packages/sdk-browser/src/host/world/placements.ts`);
// `RenderBackend.addInstance/updateInstance` receives them from host. What engine does with them is closed:
// it reads the sixteen floats from `.elements` and passes them to core.
const CALCULE_UNE_MATRICE =
  /\.(?:matrix|matrixWorld|world|transform|normalMatrix)\??\.(?:clone|copy|multiply|premultiply|multiplyMatrices|invert|decompose|compose|applyMatrix4|transformDirection|setFromMatrixPosition|extractRotation|transpose|setPosition|makeRotationFromQuaternion)\s*\(/;

/** Witness files are written with host library: rule does not target them. */
const TEMOINS =
  /^(?:backend\/(?:referenceBackend|exact\/|autonomous\/)|host\/three\/(?:lod|bounds)|cluster\/(?:batch|blendCopyMesh)|measurement\/comparison|lighting\/observation\/(?!experimentBackend))/;

/** File -> exact line -> why it SETS a host matrix instead of computing one. Empty since the
 *  second capture view became the host camera itself, read at the aspect ratio of the surface
 *  written into (`readCameraWorld`): no engine file composes into a host matrix any more. The
 *  boundary that gives a campaign its camera back writes the sixteen floats it was handed
 *  (`copyElements`), which is a copy and not a composition. */
const ECRIT_L_HOTE: Record<string, Record<string, string>> = {};

test('engine reads the host matrix, it does not compute with it', async () => {
  const fichiers = (await readdir(browser, { recursive: true })).filter(
    (nom) => nom.endsWith('.ts') && !nom.endsWith('.test.ts') && !PUBLIC_FAMILIES.test(nom),
  );
  assert.ok(fichiers.length > 100, 'the browser package must be found');
  const fuites: string[] = [],
    inutiles: string[] = [];
  for (const file of fichiers) {
    if (TEMOINS.test(file)) continue;
    const permis = ECRIT_L_HOTE[file] ?? {},
      vues = new Set<string>();
    const texte = await readFile(new URL(file, browser), 'utf8');
    for (const ligne of texte
      .split('\n')
      .filter((l) => !/^\s*(?:\/\/|\*|\/\*)/.test(l) && CALCULE_UNE_MATRICE.test(l))
      .map((l) => l.trim())) {
      if (permis[ligne]) vues.add(ligne);
      else fuites.push(`${file} computes a host matrix: ${ligne}`);
    }
    for (const ligne of Object.keys(permis))
      if (!vues.has(ligne))
        inutiles.push(`${file} declares a write that no longer exists: ${ligne}`);
  }
  assert.deepEqual(fuites, [], `boundary declared in ${import.meta.url}`);
  assert.deepEqual(inutiles, [], 'a vanished write is removed from the list');
});
