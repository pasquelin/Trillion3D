import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const browser = new URL('../../packages/sdk-browser/', import.meta.url);

// COMPUTATION BOUNDARY OF LOADING AND EXPLORER (M4a batch).
// Engine numbers are computed by `sdk-core`, never by the host 3D library: same formulas,
// same float operation order, flat buffers, no allocations per frame. What the host OWNS remains its own
// (scene, camera, materials), and engine can no longer COMPUTE using it: recomposing world matrix,
// box transformation, position extraction, inversion, decomposition. It also no longer READS world matrices
// composed by host: engine's come from local poses (`hostWorldChain.ts`, `hostWorldTree.ts`, `hostWorldPlacements.ts`),
// and the only remaining update serves host scene. Every line keeping a computation is named here with its rationale.

/** Batch files: scene loading, explorer, and their contracts. */
const M4A = [
  'awaitBackendPages',
  'backendCommon',
  'backendTypes',
  'exactPagesBounds',
  'explorerBackends',
  'explorerCamera',
  'explorerCameraApi',
  'explorerCapabilities',
  'explorerCapture',
  'explorerDisposeSource',
  'explorerDraw',
  'explorerHostState',
  'explorerLifecycle',
  'explorerOptions',
  'explorerPrepare',
  'explorerRender',
  'explorerRenderFallback',
  'explorerScene',
  'explorerSceneApi',
  'explorerViewportApi',
  'hostSceneHookCore',
  'hostSceneHooks',
  'hostSceneScan',
  'hostSceneWatch',
  'hostWorldBounds',
  'hostWorldChain',
  'hostWorldMatrices',
  'hostWorldPlacements',
  'hostWorldPose',
  'hostWorldTree',
  'pageSelectionCollect',
  'pageSelectionHelpers',
  'pagesBackendScenes',
  'replicateInstances',
  'sceneMeshes',
  'webgpuGeometryPrepare',
  'webgpuPagesPrepare',
  'webgpuPagesSetup',
  'webgpuPresentationSetup',
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
  'hostWorldMatrices.ts': {
    'node.updateMatrixWorld(true);':
      'the scene belongs to the host: it stays up to date FOR IT, and the engine no longer reads it',
  },
  'explorerCamera.ts': {
    'const bounds = new THREE.Box3(':
      '`explorer.bounds` is returned to the host: the bench computes its trajectory from it',
    'new THREE.Vector3(flat[0], flat[1], flat[2]),': 'low bound of this box returned to the host',
    'new THREE.Vector3(flat[3], flat[4], flat[5]),': 'high bound of this box returned to the host',
    'const center = new THREE.Vector3(framingSphere[0], framingSphere[1], framingSphere[2]);':
      '`explorer.center` is returned to the host, and its controls want a target',
    'const homeOffset = new THREE.Vector3().fromArray(framing.offset);':
      'home-pose offset, which `resetHome` rewrites into the host camera',
    'camera.updateMatrixWorld();': 'the host SETS its camera; the written pose is resolved once',
  },
  'explorerCameraApi.ts': {
    'camera.updateMatrixWorld();': 'return to the home pose: the host camera, reset',
  },
  'explorerHostState.ts': {
    'camera.updateMatrixWorld();': 'the host restores a recorded pose into its camera',
  },
  'explorerViewportApi.ts': {
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
// `PageRec.matrix` and `ClusterRoot.world` are host library matrices filled by ENGINE (`hostWorldPlacements.ts`);
// `RenderBackend.addInstance/updateInstance` receives them from host. What engine does with them is closed:
// it reads the sixteen floats from `.elements` and passes them to core.
const CALCULE_UNE_MATRICE =
  /\.(?:matrix|matrixWorld|world|transform|normalMatrix)\??\.(?:clone|copy|multiply|premultiply|multiplyMatrices|invert|decompose|compose|applyMatrix4|transformDirection|setFromMatrixPosition|extractRotation|transpose|setPosition|makeRotationFromQuaternion)\s*\(/;

/** Witness files are written with host library: rule does not target them. */
const TEMOINS =
  /^(?:referenceBackend|threeLod|threeBounds|exactPages|autonomous|clusterBatch|blendCopyMesh|comparison|lightingObservation)/;

/** File -> exact line -> why it SETS a host matrix instead of computing one. */
const ECRIT_L_HOTE: Record<string, Record<string, string>> = {
  'cameraWorld.ts': {
    'into.matrix.copy(camera.matrixWorld);':
      'detached copy of a host camera: it SETS the world pose, it does not compute it',
    'into.matrixWorld.copy(into.matrix);': 'the same copy, resolved in place for lack of a parent',
  },
};

test('engine reads the host matrix, it does not compute with it', async () => {
  const fichiers = (await readdir(browser)).filter(
    (nom) => nom.endsWith('.ts') && !nom.endsWith('.test.ts'),
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
