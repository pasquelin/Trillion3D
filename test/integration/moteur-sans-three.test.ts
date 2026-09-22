import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const browser = new URL('../../packages/sdk-browser/', import.meta.url);

// CLOSED LIST OF `sdk-browser` FILES ALLOWED TO IMPORT THE HOST LIBRARY.
//
// The rule is inverted: it is no longer a watch list of files, it is the list of EVERYTHING
// that can still name `three`. A file outside the list does not import it — `import type` included,
// because a calculation type in a signature is enough to put the host library back in the
// middle of a number that the engine calculates. Only three families are allowed.
//
//  1. WITNESS ENGINES. Written with the host library, and that is their function: they
//     are the reference against which the engine is compared, frame by frame. Rewriting them
//     would eliminate the comparison.
//  2. HOST BOUNDARIES. Scene, camera, renderer, lights belong to the host: something must
//     create, read, and set them. These files do it once, returning flat buffers or owned structures.
//  3. HOST RESOURCES. Materials, textures, geometries, meshes, colors, face/winding constants:
//     objects that the engine consults without ever calculating with.
//
// Adding a line is a decision, not an oversight; removing an unused line as well — the
// second test fails on a dead line. The camera pose contract lives in `cameraWorld.ts`
// and `test/integration/structure-moteur.test.ts`; the loading computation boundary, in
// `test/integration/moteur-sans-three-math.test.ts`.
const AUTORISES: Record<string, string> = {
  // 1. Witness engines.
  autonomousGeometry: 'autonomous witness: it mounts its meshes with the host library',
  autonomousInstances: 'autonomous witness: its instances carry host matrices',
  autonomousPages: 'autonomous witness: its pages are host geometries',
  blendCopyMesh: 'witness: the transparent copy is a host mesh',
  clusterBatchesFixture: 'batch-witness mount',
  exactPagesAttachment: 'exact witness: it attaches its pages to the host graph',
  exactPagesBackend: 'exact witness: engine written with the host library',
  exactPagesContractLights: 'exact witness: it maps contract lights to host-library lights',
  exactPagesMaterials: 'exact witness: its materials are the host’s',
  exactPagesUnlitAlbedo: 'exact witness: its unlit view zeros the host material factors',
  exactPagesMetrics: 'exact witness: the host meshes and geometries it counts and disposes',
  exactPagesRender: 'exact witness: the host camera and scene copies its frame reads',
  explorerCameraApi:
    'boundary: the orbit and fly controls of `three/addons` it returns to the host',
  exactPagesRequests: 'exact witness: its requests start from its host graph',
  lightingObservationResources: 'boundary: the empty host scene the experiment publishes',
  referenceBackend: 'reference witness: the host engine, as-is',
  threeBounds: 'witness: bounds as the host library computes them',
  threeLod: 'witness: the host level-of-detail selection, `LOD.update` included',
  threeSceneAdapter:
    'witness adapter: the one host renderer the witnesses share to draw their scenes',

  // 2. Host boundaries: scene, camera, renderer, lights, poses.
  backendCommon: 'boundary: it creates the scene each engine renders to the host',
  cameraWorld: 'camera-pose contract: the only one that maps a host camera to an engine camera',
  explorerBackends: 'boundary: it mounts engines on the host renderer',
  explorerCamera: 'boundary: the host SETS its camera, and rereads `bounds` and `center`',
  explorerDisposeSource: 'boundary: it frees host-graph resources',
  exactPagesBounds: 'boundary: it walks the host source graph to bound its pages',
  explorerScene: 'boundary: it builds the host’s prepared scene',
  hostSceneHooks: 'boundary: it hooks the fields the host writes on its nodes',
  hostSceneScan: 'boundary: it compares the fields the host writes that no hook may touch',
  hostSceneWatch: 'boundary: it names the host nodes whose writes are listened to',
  hostWorldBounds: 'boundary: host-graph bounds, returned flat',
  hostWorldChain: 'boundary: it reads the ancestor chain of a host node',
  hostWorldMatrices: 'boundary: the local pose of a host node, read flat',
  hostWorldPose: 'boundary: it reads the local pose of a host node into the engine tree',
  hostWorldTree: 'boundary: it reads local poses of a host subtree',
  pageSelectionCollect: 'boundary: it walks the host source graph',
  replicateInstances: 'boundary: it replicates nodes of the host graph',
  sceneLighting: 'boundary: contract lights placed in the host scene',
  sceneMeshes: 'boundary: it enumerates meshes of the host graph',
  webgpuPagesSurfaceCapture: 'boundary: capture enters through a host camera',
  webgpuPagesTransform: 'boundary: the host moves a subtree of its scene',

  // 2 bis. Test-scene mounts and oracles that walk the host graph.
  pageRaster: 'raster oracle: it reads meshes, materials and colours of the host graph',
  pageSelectionBlendFixture: 'test-scene mount: it sets the camera and materials',
  pageSelectionDagFixture: 'test-scene mount: it sets the camera and materials',
  pagesBackendScenes: 'test-scene mount: it sets the camera',
  visibilityBufferFixture: 'test-scene mount: it sets the camera and pages',
  webgpuPagesTestOccluder: 'test-scene mount: the occluder and its camera',
  webgpuPagesTestScenes: 'test-scene mounts: meshes and materials',
  webgpuTransformCisaillementFixture:
    'test mount: minimal scene and runtime for `setWebgpuTransform`',
  webgpuWaterPassFixture: 'test mount: three transparent host meshes, one of which transmits',

  // 3. Host resources: materials, textures, geometries, colours, face constants. The contract
  //    types no longer name them (#269): materials, textures, attributes, meshes and scene nodes
  //    cross the engine as `hostResources.ts` shapes, and only the files below turn one back into
  //    the host library's own type, through `asHostLibrary`.
  explorerDiagnosticApi: 'it replaces host materials and geometries with diagnostic ones',
  triangleDiagnostic: 'it colours a host geometry in a host material',
  visibilityMath: 'host attributes, textures and wrap modes',
  visibilityMaterial: 'host material properties converted to engine material',
  visibilityWrapModes: 'host-texture wrap modes',
  webgpuBlendPrepare: 'host meshes and materials to prepare',
  webgpuMaterialTextures: 'host-material textures',
  webgpuPagesHelpers: 'host colours and colour management',
  webgpuPagesPrepare: 'host geometry attributes',
  webgpuPagesSetup: 'meshes of the host scene',
};

const IMPORTE_HOTE = /^\s*(?:import|export)\b[^\n]*\bfrom\s+['"]three(?:\/[^'"]*)?['"]/m;
/** A call of the crossing back, `asHostLibrary<T>(x)` or `asHostLibrary(x)`, never its import. */
const TRAVERSE = /\basHostLibrary\s*[<(]/;

const sources = async () =>
  (await readdir(browser)).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));

/** Files outside the closed list where a pattern appears; `exclu` is the file that declares it. */
async function horsListe(motif: RegExp, exclu = ''): Promise<string[]> {
  const fuites: string[] = [];
  for (const file of await sources()) {
    if (file === exclu || AUTORISES[file.slice(0, -3)]) continue;
    if (motif.test(await readFile(new URL(file, browser), 'utf8'))) fuites.push(file);
  }
  return fuites;
}

test('only declared files import the host library', async () => {
  assert.ok((await sources()).length > 100, 'the browser package must be found');
  const fuites = await horsListe(IMPORTE_HOTE);
  assert.deepEqual(fuites, [], `closed list declared in ${import.meta.url}`);
});

// `hostResources.ts` declares the crossing; the same closed list says who may call it, so the
// doc of `asHostLibrary` stays a rule and not a hope.
test('only the declared boundary files cross back through `asHostLibrary`', async () => {
  const fuites = await horsListe(TRAVERSE, 'hostResources.ts');
  assert.deepEqual(fuites, [], `the crossing back belongs to the list of ${import.meta.url}`);
});

test('no dead lines: each declared file exists and still imports', async () => {
  const fichiers = new Set(await sources());
  const morts = [];
  for (const [nom, raison] of Object.entries(AUTORISES)) {
    const file = `${nom}.ts`;
    assert.ok(raison.length > 10, `${file} must say why`);
    if (!fichiers.has(file)) morts.push(`${file} no longer exists`);
    else if (!IMPORTE_HOTE.test(await readFile(new URL(file, browser), 'utf8')))
      morts.push(`${file} no longer imports the host library: remove its line`);
  }
  assert.deepEqual(morts, [], 'an unused authorisation is removed from the list');
});

test('`cameraWorld.ts` remains the only translation from host camera to engine camera', async () => {
  const texte = await readFile(new URL('cameraWorld.ts', browser), 'utf8');
  assert.match(texte, /export type HostCamera = THREE\.PerspectiveCamera/);
  assert.match(texte, /export function readCameraWorld\(/);
  const moteur = await readFile(new URL('engineCamera.ts', browser), 'utf8');
  for (const champ of ['world', 'projection', 'view', 'viewProjection', 'planes', 'eye'])
    assert.match(moteur, new RegExp(`\\b${champ}\\b`), champ);
});
