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

/**
 * A module specifier of the host library, in a source, in emitted code or in a declaration: the
 * one pattern every no-Three guard reads. It keys on the specifier, not on the statement, so a
 * multi-line `import {…}\nfrom 'three'`, a bare `import 'three'`, a dynamic `import('three')`,
 * an `export … from 'three'` and any `three/…` subpath (`three/addons/…`) are all caught.
 */
export const NAMES_THREE = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"]three(?:\/[^'"]*)?['"]/;

// CLOSED LIST OF `sdk-browser` FILES ALLOWED TO IMPORT THE HOST LIBRARY.
//
// The rule is inverted: it is no longer a watch list of files, it is the list of EVERYTHING
// that can still name `three`. A file outside the list does not import it — `import type` included,
// because a calculation type in a signature is enough to put the host library back in the
// middle of a number that the engine calculates. Since #275 only TEST MOUNTS are left: fixtures,
// which the package's `files` never ship. Every other source under `packages/*/` names no host
// library at all, and `engine-without-three.test.ts` refuses one that does.
//
//  1. WITNESS ENGINES left the package. Written with the host library, and that is their function:
//     they are the reference against which the engine is compared, frame by frame. They live
//     beside the bench (`bench/witnesses/`), are bundled for it by `scripts/build-witnesses.ts`
//     into `dist/witnesses/`, which the package leaves out, and plug into the engine through the
//     `BackendFactory` list its measurement seam takes (`packages/sdk-browser/src/measurement/measurement.ts`).
//  2. HOST BOUNDARIES — the family is empty. The autonomous WebGL2 path's pages, copies and
//     lights are objects of the engine's own graph (`packages/sdk-browser/src/host/pageObjects.ts`,
//     `packages/sdk-browser/src/host/graph/`), drawn by the engine's program
//     (`packages/sdk-browser/src/webgl/cluster/sceneDraw.ts`).
//  3. HOST RESOURCES — the family is empty. Materials, textures, geometries and the constants
//     they declare are read through the shapes of `packages/sdk-browser/src/host/resources.ts` and `packages/sdk-browser/src/host/shadedMaterial.ts`
//     and the named constants of `packages/sdk-browser/src/host/surfaceConstants.ts`.
//
// THE HOST SCENE GRAPH AND ITS CAMERA are written against the shapes of
// `packages/sdk-browser/src/host/scene/graphNodes.ts` and the `HostCamera` of `packages/sdk-browser/src/camera/world.ts`. The graphs the engine
// BUILDS — the prepared scene, a world's mirror, the explorer's camera — are its own objects of
// those shapes (`packages/sdk-browser/src/host/graph/`); a witness renderer receives a copy made on its
// side of the line (`bench/witnesses/three/fromGraph.ts`).
//
// Adding a line is a decision, not an oversight; removing an unused line as well — the
// second test fails on a dead line. The camera pose contract lives in `packages/sdk-browser/src/camera/world.ts`
// and `tests/integration/engine-structure.test.ts`; the loading computation boundary, in
// `tests/integration/engine-without-three-math.test.ts`.
export const AUTORISES: Record<string, string> = {
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
  'bench/witnesses/exact/batches/batchUpdate':
    'exact witness: its draw record hands the declaration to the host renderer',
  'bench/witnesses/exact/batches/batches.fixture': 'batch-witness mount',
  'bench/witnesses/exact/materials': 'exact witness: the host material each page is drawn with',
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
