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
// and `test/integration/structure-moteur.test.mjs`; the loading computation boundary, in
// `test/integration/moteur-sans-three-math.test.mjs`.
const AUTORISES = {
  // 1. Witness engines.
  autonomousGeometry: 'autonomous witness: it mounts its meshes with the host library',
  autonomousInstances: 'autonomous witness: its instances carry host matrices',
  autonomousPages: 'autonomous witness: its pages are host geometries',
  blendCopyMesh: 'witness: the transparent copy is a host mesh',
  clusterBatches: 'batch witness: it groups host geometries',
  clusterBatchesFixture: 'batch-witness mount',
  clusterBatchLayers: 'batch witness: host mesh layers',
  clusterBatchMesh: 'batch witness: it derives a host mesh',
  clusterBatchPrimitive: 'batch witness: one host primitive per material',
  clusterBatchRange: 'batch witness: index ranges of a host geometry',
  clusterBatchSetup: 'batch witness: mount of its primitives',
  clusterBatchUpdate: 'batch witness: rewrite of its ranges',
  comparison: 'comparison witness: it composes two images through a host scene',
  exactPagesAttachment: 'exact witness: it attaches its pages to the host graph',
  exactPagesBackend: 'exact witness: engine written with the host library',
  exactPagesContractLights: 'exact witness: it maps contract lights to host-library lights',
  exactPagesMaterials: 'exact witness: its materials are the host’s',
  exactPagesUnlitAlbedo: 'exact witness: its unlit view zeros the host material factors',
  exactPagesMetrics: 'exact witness: it counts what the host renderer submitted',
  exactPagesRender: 'exact witness: it renders through the host renderer',
  exactPagesRequests: 'exact witness: its requests start from its host graph',
  lightingObservationMeshes: 'lighting witness: observed host meshes',
  lightingObservationResources: 'lighting witness: its resources are the host’s',
  referenceBackend: 'reference witness: the host engine, as-is',
  threeBounds: 'witness: bounds as the host library computes them',
  threeLod: 'witness: the host level-of-detail selection, `LOD.update` included',

  // 2. Host boundaries: scene, camera, renderer, lights, poses.
  backendCommon: 'boundary: it creates the scene each engine renders to the host',
  cameraWorld: 'camera-pose contract: the only one that maps a host camera to an engine camera',
  explorerBackends: 'boundary: it mounts engines on the host renderer',
  explorerCamera: 'boundary: the host SETS its camera, and rereads `bounds` and `center`',
  explorerCameraApi: 'boundary: pose round-trip between the host and its camera',
  explorerCapabilities: 'boundary: it queries the host renderer’s context',
  explorerCapture: 'boundary: it reads pixels of the host target',
  explorerDisposeSource: 'boundary: it frees host-graph resources',
  explorerDraw: 'boundary: it calls the host renderer',
  // Split out of `explorerDraw`, not a new dependency: the same boundary, on its own file.
  explorerDrawScene: 'boundary: it draws the scene an engine hands to the host renderer',
  explorerHeldFrame: 'boundary: it recomposes the held image in a host scene',
  explorerHostState: 'boundary: it restores a recorded pose into the host camera',
  explorerLifecycle: 'boundary: it creates and destroys the host renderer',
  explorerPrepare: 'boundary: it prepares the host source graph',
  explorerRender: 'boundary: the host frame loop, its targets and its textures',
  explorerRenderFallback: 'boundary: fallback when the host renderer throws',
  exactPagesBounds: 'boundary: it walks the host source graph to bound its pages',
  explorerScene: 'boundary: it builds the host’s prepared scene',
  frameGateCore: 'boundary: the frame gate listens to the host source node',
  hostSceneHooks: 'boundary: it hooks the fields the host writes on its nodes and lights',
  hostSceneWatch: 'boundary: it names the host nodes whose writes are listened to',
  hostWorldBounds: 'boundary: host-graph bounds, returned flat',
  hostWorldChain: 'boundary: it reads the ancestor chain of a host node',
  hostWorldMatrices: 'boundary: the local pose of a host node, read flat',
  hostWorldPlacements:
    'boundary: the matrix container the host attaches and witnesses draw, filled by the engine',
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
  pagesBackendFixture: 'test mount: it counts what host meshes draw',
  pagesBackendScenes: 'test-scene mount: it sets the camera',
  visibilityBufferFixture: 'test-scene mount: it sets the camera and pages',
  webgpuPagesTestOccluder: 'test-scene mount: the occluder and its camera',
  webgpuPagesTestScenes: 'test-scene mounts: meshes and materials',
  webgpuTransformCisaillementFixture:
    'test mount: minimal scene and runtime for `setWebgpuTransform`',

  // 3. Host resources: materials, textures, geometries, colours, face constants.
  backendTypes: 'contract: host resources an engine receives',
  explorerOptions: 'contract: host resources the host declares',
  explorerDiagnosticApi: 'it replaces host materials and geometries with diagnostic ones',
  explorerSceneApi: 'contract: materials and poses the host rewrites on its scene',
  explorerViewportApi: 'boundary: the capture view is a host camera',
  gpuDagTypes: 'contract: materials and matrices the host writes',
  gpuSelection: 'host material type carried by a page',
  materialSide: 'host-material face constants, read once into the engine `Side`',
  pageCone: 'host material type carried by a page',
  pageSelectionCutState: 'host material carried by a page',
  pageSelectionHelpers: 'host material type carried by a page',
  pageSelectionTypes: 'contract: geometries, materials and matrices the host writes',
  triangleDiagnostic: 'it colours a host geometry in a host material',
  visibilityMath: 'host attributes, textures and wrap modes',
  visibilityMaterial: 'host material properties converted to engine material',
  visibilityTypes: 'contract: host materials, textures and colours',
  visibilityWrapModes: 'host-texture wrap modes',
  webglClusterBatchDraw: 'host meshes whose autonomous submissions it counts',
  webglClusterOwner: 'contract: host diagnostic meshes submitted by the owner',
  webglClusterRenderer: 'host materials and geometries converted for autonomous drawing',
  webglClusterSubmit: 'host geometry buffers submitted by the autonomous renderer',
  webglClusterValidation: 'host materials and attributes validated before autonomous drawing',
  webgpuTileAtlas: 'host texture as a tile source',
  webgpuTileCatalogue: 'host textures in the pool catalogue',
  webgpuTileScratch: 'host image transferred into the working texture',
  webgpuBlendBuffers: 'host geometry attributes',
  webgpuBlendItems: 'contract: host textures stored by an item record',
  webgpuBlendPrepare: 'host meshes and materials to prepare',
  webgpuBlendState: 'contract: geometries, materials and matrices the host writes',
  webgpuGeometryPrepare: 'host geometries to prepare',
  webgpuMaterialTextures: 'host-material textures',
  webgpuPageRow: 'host geometry and textures of a row',
  webgpuPagesHelpers: 'host colours and colour management',
  webgpuPagesPrepare: 'host geometry attributes',
  webgpuPagesSetup: 'meshes of the host scene',
  webgpuPagesStateGpu: 'contract: host geometries and textures',
  webgpuPagesStateVis: 'contract: host geometries and textures',
  webgpuPositions: 'position attribute of the host geometry',
};

const IMPORTE_HOTE = /^\s*(?:import|export)\b[^\n]*\bfrom\s+['"]three['"]/m;

const sources = async () =>
  (await readdir(browser)).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));

test('only declared files import the host library', async () => {
  const fichiers = await sources();
  assert.ok(fichiers.length > 100, 'the browser package must be found');
  const fuites = [];
  for (const file of fichiers) {
    if (AUTORISES[file.slice(0, -3)]) continue;
    const texte = await readFile(new URL(file, browser), 'utf8');
    if (IMPORTE_HOTE.test(texte)) fuites.push(file);
  }
  assert.deepEqual(fuites, [], `closed list declared in ${import.meta.url}`);
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
