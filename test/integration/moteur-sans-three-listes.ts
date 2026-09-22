/**
 * The two closed lists `moteur-sans-three.test.ts` enforces, and nothing else: the files of
 * `sdk-browser` allowed to name the host library, and those allowed to read the host declaration a
 * page was collected from. They live here so the test that reads them stays readable.
 */

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
//     THE HOST-RENDERED IMAGE IS ONE OF THEM, and it is not a witness's alone: the autonomous
//     WebGL2 path is what `chooseBackends` picks on a machine that grants no WebGPU device, and
//     its pages are drawn by the host renderer, lit by host lights. Its three files were filed
//     under family 1 until lot 3 of #78 — "autonomous witness", which it never was. They name no
//     library now; the objects they draw with are built by `hostPageObjects.ts`, and the renderer,
//     the lights and the bounds they share with the witnesses are declared here as what they are:
//     the boundary of an image drawn by the host, on the shipping path as on the witnesses.
//  3. HOST RESOURCES — the family is empty. Materials, textures, geometries and the constants
//     they declare are read through the shapes of `hostResources.ts` and `hostShadedMaterial.ts`
//     and the named constants of `hostSurfaceConstants.ts`: since this lot the import, the
//     admission gate and the transparent display graph name no library either, and bundling
//     `webgpuPages.ts` pulls no module of one.
//
// THE HOST SCENE GRAPH AND ITS CAMERA left the list in their turn: the walk, the bounds, the
// poses, the watch and the camera-pose contract are written against the shapes of
// `hostGraphNodes.ts` and the `HostCamera` of `cameraWorld.ts`. What remains of them here is
// the one file that BUILDS a host object instead of reading one, `hostGraphObjects.ts`.
//
// Adding a line is a decision, not an oversight; removing an unused line as well — the
// second test fails on a dead line. The camera pose contract lives in `cameraWorld.ts`
// and `test/integration/structure-moteur.test.ts`; the loading computation boundary, in
// `test/integration/moteur-sans-three-math.test.ts`.
export const AUTORISES: Record<string, string> = {
  // 1. Witness engines.
  blendCopyMesh: 'witness: its transparent copy is a host mesh, handed to the host renderer',
  clusterBatchesFixture: 'batch-witness mount',
  exactPagesAttachment: 'exact witness: it attaches its pages to the host graph',
  exactPagesBackend: 'exact witness: engine written with the host library',
  exactPagesMaterials: 'exact witness: its materials are the host’s',
  exactPagesMetrics: 'exact witness: the host meshes and geometries it counts and disposes',
  exactPagesRender: 'exact witness: the host camera and scene copies its frame reads',
  exactPagesRequests: 'exact witness: its requests start from its host graph',
  referenceBackend: 'reference witness: the host engine, as-is',
  threeLod: 'witness: the host level-of-detail selection, `LOD.update` included',

  // 2. Host boundaries: scene, camera, renderer, lights, poses.
  explorerScene: 'boundary: it builds the host’s prepared scene',
  hostGraphObjects:
    'boundary: the host camera, framing points and instance copies the explorer builds for its host',
  hostPageObjects:
    'boundary: the scene, meshes, geometries and surfaces the WebGL2 page path is drawn with',
  hostSceneObjects:
    'boundary: the host colours, lights and nodes an engine drawn by the host renderer hangs on its display graph',
  exactPagesContractLights:
    'boundary: the contract lights of an image the host renderer draws, mapped to host lights',
  exactPagesUnlitAlbedo:
    'boundary: the unlit view of that image zeros the host material factors for the frame',
  threeBounds: 'boundary: bounds written back into a host geometry, as the library computes them',
  threeSceneAdapter:
    'boundary: the host renderer the witnesses and the WebGL2 page path share, and the materials and geometry copies their diagnostic views hang on a host mesh',

  // 2 bis. Test-scene mounts that walk the host graph.
  pageSelectionBlendFixture: 'test-scene mount: it sets the camera and materials',
  pageSelectionDagFixture: 'test-scene mount: it sets the camera and materials',
  pagedQuadFixture: 'test-scene mount: the quad clustered into quantized pages',
  pagesBackendScenes: 'test-scene mount: it sets the camera',
  visibilityBufferFixture: 'test-scene mount: it sets the camera and pages',
  webgpuPagesTestOccluder: 'test-scene mount: the occluder and its camera',
  webgpuPagesTestScenes: 'test-scene mounts: meshes and materials',
  webgpuTransformCisaillementFixture:
    'test mount: minimal scene and runtime for `setWebgpuTransform`',
  webgpuWaterPassFixture: 'test mount: three transparent host meshes, one of which transmits',
};

// CLOSED LIST OF FILES ALLOWED TO READ `declaration` — the host material a page was read from.
//
// Since lot 4b of #78 a page carries the engine's own surface record (`pageSurface.ts`) and the
// engine path reads nothing else: the cut, the rows, the raster, the transparent items and the
// audit all compute on that record. `declaration` is the host object itself, kept for the one
// use that needs it — handing a surface back to the library that owns it. Reading it anywhere
// else puts the host material back in the middle of a number the engine computes.
// The keys are paths under `packages/sdk-browser/`, extension dropped: the rule reads the
// benches too, since a bench builds the page records the engine path then reads.
export const DECLARATION: Record<string, string> = {
  clusterBatchRange: 'contract: it declares the field on a batch page',
  pageSelectionTypes: 'contract: it declares the field on a page record',
  pageSelectionCollect: 'the collection sets it, once, beside the record it built',
  autonomousGeometry: 'WebGL2 page path: it repaints its pages with host materials',
  autonomousInstances: 'WebGL2 page path: it repaints its instances with host materials',
  autonomousPages: 'WebGL2 page path: it keeps the base paint of each page',
  hostPageObjects: 'boundary: the declaration it gives back to the library that draws it',
  clusterBatchUpdate: 'the WebGL2 draw record hands the declaration to the host renderer',
  clusterBatchesFixture: 'batch-witness mount',
  exactPagesMaterials: 'exact witness: the host material each page is drawn with',
  webglClusterCompatibility: 'the admission gate reads the declaration it refuses',

  // Benches and oracles: they mount the page records the engine path is measured on, and a record
  // carries the declaration its witness repaints from.
  'bench/appui/pageRecFixture': 'bench fixture: the page record it builds carries the field',
  'bench/appui/scenesCoupe': 'bench mount: it pairs a host material with the record of it',
  'bench/backend-autonome.perf': 'bench: its pages carry the declaration the witness repaints with',
  'bench/cadre-vue.perf': 'bench: the page records it builds carry the field',
  'bench/coupe-difference.perf': 'bench: the page records it builds carry the field',
  'bench/lignes-dessinables.perf': 'bench: the page records it builds carry the field',
  'bench/oracles/collecte-pages': 'oracle: the frozen collection sets the field as the engine does',
  'bench/pages-webgpu.perf': 'bench: the page records it builds carry the field',
};
