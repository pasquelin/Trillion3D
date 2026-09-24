/**
 * The two closed lists `engine-without-three.test.ts` enforces — the files of `sdk-browser` allowed
 * to name the host library, and those allowed to read the host declaration a page was collected
 * from — and the families the pose rules leave out. They live here so the tests stay readable.
 */

/**
 * The page-word families of the world API and the placement rows (`world/core/`, the `index.ts` of
 * each family, `placement/`): they pose the core's own scene objects, so the camera-pose and
 * host-matrix rules of `engine-structure.test.ts` and `engine-without-three-math.test.ts` do not
 * read them. The host-library rules of `engine-without-three.test.ts` read them like any other
 * source: the two files there that build host objects are declared in `AUTORISES`.
 */
export const PUBLIC_FAMILIES =
  /^(?:placement\/|world\/(?:core|batch|budget|capability|controls|helper|loader|metric|page|pose|saved|texture)\/|world\/(?:capture|diagnostic)\/(?:index|worldNotices)\.ts$)/;

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
//     The autonomous WebGL2 path — what `chooseBackends` picks on a machine that grants no WebGPU
//     device — is no longer one of them: since #275 its pages, copies and lights are objects of the
//     engine's own graph (`packages/sdk-browser/src/host/pageObjects.ts`, `packages/sdk-browser/src/host/graph/`),
//     drawn by the engine's program (`packages/sdk-browser/src/webgl/cluster/sceneDraw.ts`), and
//     bundling `packages/sdk-browser/src/index.ts` pulls no module of the library.
//  3. HOST RESOURCES — the family is empty. Materials, textures, geometries and the constants
//     they declare are read through the shapes of `packages/sdk-browser/src/host/resources.ts` and `packages/sdk-browser/src/host/shadedMaterial.ts`
//     and the named constants of `packages/sdk-browser/src/host/surfaceConstants.ts`: since this lot the import, the
//     admission gate and the transparent display graph name no library either, and bundling
//     `packages/sdk-browser/src/webgpu/pages/pages.ts` pulls no module of one.
//
// THE HOST SCENE GRAPH AND ITS CAMERA left the list in their turn: the walk, the bounds, the
// poses, the watch and the camera-pose contract are written against the shapes of
// `packages/sdk-browser/src/host/scene/graphNodes.ts` and the `HostCamera` of `packages/sdk-browser/src/camera/world.ts`. The graphs the engine
// BUILDS — the prepared scene, a world's mirror, the explorer's camera — are its own objects of
// those shapes (`packages/sdk-browser/src/host/graph/`); a renderer of the library receives a copy made on its
// side of the line (`packages/sdk-browser/src/host/three/fromGraph.ts`).
//
// Adding a line is a decision, not an oversight; removing an unused line as well — the
// second test fails on a dead line. The camera pose contract lives in `packages/sdk-browser/src/camera/world.ts`
// and `tests/integration/engine-structure.test.ts`; the loading computation boundary, in
// `tests/integration/engine-without-three-math.test.ts`.
export const AUTORISES: Record<string, string> = {
  // 1. Witness engines.
  'cluster/batches.fixture': 'batch-witness mount',
  'backend/exact/attachment': 'exact witness: it attaches its pages to the host graph',
  'backend/exact/backend': 'exact witness: engine written with the host library',
  'backend/exact/materials': 'exact witness: its materials are the host’s',
  'backend/referenceBackend': 'reference witness: the host engine, as-is',
  'host/three/lod': 'witness: the host level-of-detail selection, `LOD.update` included',
  'host/three/fromGraph':
    'witness: the engine graph’s resources copied into the library the reference renderer draws',
  'host/three/fromGraphNodes':
    'witness: the engine graph’s nodes, lights and camera copied into that library',
  'host/three/displayObjects':
    'witness: the background, lights and nodes hung on the display graph the reference renderer draws',
  'host/three/sceneAdapter':
    'witness: the host renderer the witnesses share, and the materials and geometry copies their diagnostic views hang on a host mesh',

  // 2 bis. Test-scene mounts that walk the host graph.
  'page/selection/blend.fixture': 'test-scene mount: it sets the camera and materials',
  'page/selection/dag.fixture': 'test-scene mount: it sets the camera and materials',
  'webgpu/pages/pagedQuad.fixture': 'test-scene mount: the quad clustered into quantized pages',
  'backend/pagesBackendScenes.fixture': 'test-scene mount: it sets the camera',
  'visibility/buffer.fixture': 'test-scene mount: it sets the camera and pages',
  'webgpu/pages/testOccluder.fixture': 'test-scene mount: the occluder and its camera',
  'webgpu/pages/testScenes.fixture': 'test-scene mounts: meshes and materials',
  'webgpu/core/transformShear.fixture':
    'test mount: minimal scene and runtime for `setWebgpuTransform`',
  'webgpu/water/pass.fixture': 'test mount: three transparent host meshes, one of which transmits',
  'host/prepared/scenes.fixture':
    'test mount: the prepared-scene proof reads the loader’s graph and the reference renderer’s copy',
};

// CLOSED LIST OF FILES ALLOWED TO READ `declaration` — the host material a page was read from.
//
// Since lot 4b of #78 a page carries the engine's own surface record (`packages/sdk-browser/src/page/surface.ts`) and the
// engine path reads nothing else: the cut, the rows, the raster, the transparent items and the
// audit all compute on that record. `declaration` is the host object itself, kept for the one
// use that needs it — handing a surface back to the library that owns it. Reading it anywhere
// else puts the host material back in the middle of a number the engine computes.
// The keys are paths under `packages/sdk-browser/`, extension dropped; a bench is keyed by its path
// from the repository root: the rule reads the benches too, since a bench builds the page records
// the engine path then reads.
export const DECLARATION: Record<string, string> = {
  'cluster/batchRange': 'contract: it declares the field on a batch page',
  'page/selection/types': 'contract: it declares the field on a page record',
  'page/selection/collect': 'the collection sets it, once, beside the record it built',
  'backend/autonomous/geometry': 'WebGL2 page path: it repaints its pages with host materials',
  'backend/autonomous/instances': 'WebGL2 page path: it repaints its instances with host materials',
  'backend/autonomous/pages': 'WebGL2 page path: it keeps the base paint of each page',
  'placement/webglPageBatches':
    'WebGL2 page path: the pages rows place are drawn instanced, one mesh per page and declaration',
  'host/pageObjects': 'boundary: the declaration it gives back to the library that draws it',
  'cluster/batchUpdate': 'the WebGL2 draw record hands the declaration to the host renderer',
  'cluster/batches.fixture': 'batch-witness mount',
  'backend/exact/materials': 'exact witness: the host material each page is drawn with',
  'webgl/cluster/compatibility': 'the admission gate reads the declaration it refuses',

  // Benches and oracles: they mount the page records the engine path is measured on, and a record
  // carries the declaration its witness repaints from.
  'bench/perf/browser/support/pageRecFixture':
    'bench fixture: the page record it builds carries the field',
  'bench/perf/browser/support/scenesCut':
    'bench mount: it pairs a host material with the record of it',
  'bench/perf/browser/autonomous-backend.perf':
    'bench: its pages carry the declaration the witness repaints with',
  'bench/perf/browser/view-frame.perf': 'bench: the page records it builds carry the field',
  'bench/perf/browser/cut-diff.perf': 'bench: the page records it builds carry the field',
  'bench/perf/browser/drawable-rows.perf': 'bench: the page records it builds carry the field',
  'bench/oracles/browser/page-collection':
    'oracle: the frozen collection sets the field as the engine does',
  'bench/perf/browser/pages-webgpu.perf': 'bench: the page records it builds carry the field',
};
