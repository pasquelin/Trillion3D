/**
 * What `engine-without-three.test.ts` enforces — the closed list of the files allowed to read the
 * host declaration a page was collected from, and the pattern of the benches that read it — and
 * the families the pose rules leave out. They live here so the tests stay readable.
 */

/**
 * The page-word families of the world API and the placement rows (`world/core/`, the `world/api/*Family.ts` modules, the `index.ts` of
 * each family, `placement/`): they pose the core's own scene objects, so the camera-pose and
 * host-matrix rules of `engine-structure.test.ts` and `engine-without-three-math.test.ts` do not
 * read them. The host-library rules of `engine-without-three.test.ts` read them like any other
 * source: no file there names the host library.
 */
export const PUBLIC_FAMILIES =
  /^(?:placement\/|world\/(?:core|batch|budget|capability|controls|helper|loader|metric|page|pose|saved|texture)\/|world\/api\/\w+Family\.ts$|world\/(?:capture|diagnostic)\/(?:index|worldNotices)\.ts$)/

/**
 * A module specifier of the host library, in a source, in emitted code or in a declaration: the
 * one pattern every no-Three guard reads. It keys on the specifier, not on the statement, so a
 * multi-line `import {…}\nfrom 'three'`, a bare `import 'three'`, a dynamic `import('three')`,
 * an `export … from 'three'` and any `three/…` subpath (`three/addons/…`) are all caught.
 */
export const NAMES_THREE = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"]three(?:\/[^'"]*)?['"]/

// NO `sdk-browser` FILE IMPORTS THE HOST LIBRARY.
//
// A file does not import it — `import type` included, because a calculation type in a signature is
// enough to put the host library back in the middle of a number that the engine calculates. No
// source under `packages/*/` names it, fixtures included, and `engine-without-three.test.ts`
// refuses one that does.
//
//  1. WITNESS ENGINES are written with the host library, and that is their function: they are the
//     reference against which the engine is compared, frame by frame. They live outside the
//     package, beside the bench (`bench/witnesses/`), are bundled for it by
//     `scripts/build-witnesses.ts` into `dist/witnesses/`, which the package leaves out, and draw
//     in pages of their own (`bench/runner/witness/threeMeasurePage.ts`), never as the engine.
//  2. The pages, copies and lights a page hands back are objects of the engine's own graph
//     (`packages/sdk-browser/src/host/pageObjects.ts`, `packages/sdk-browser/src/host/graph/`).
//  3. Materials, textures, geometries and the constants they declare are read through the shapes
//     of `packages/sdk-browser/src/host/resources.ts` and `packages/sdk-browser/src/host/shadedMaterial.ts`
//     and the named constants of `packages/sdk-browser/src/host/surfaceConstants.ts`.
//
// THE HOST SCENE GRAPH AND ITS CAMERA are written against the shapes of
// `packages/sdk-browser/src/host/scene/graphNodes.ts` and the `HostCamera` of `packages/sdk-browser/src/camera/world.ts`. The graphs the engine
// BUILDS — the prepared scene, a world's mirror, the explorer's camera — are its own objects of
// those shapes (`packages/sdk-browser/src/host/graph/`); a witness renderer receives a copy made on its
// side of the line (`bench/witnesses/three/fromGraph.ts`).
//
// The camera pose contract lives in `packages/sdk-browser/src/camera/world.ts` and
// `tests/integration/engine-structure.test.ts`; the loading computation boundary, in
// `tests/integration/engine-without-three-math.test.ts`.

// CLOSED LIST OF FILES ALLOWED TO READ `declaration` — the host material a page was read from.
//
// A page carries the engine's own surface record (`packages/sdk-browser/src/page/surface.ts`) and
// the engine path reads nothing else: the cut, the rows, the raster, the transparent items and the
// audit all compute on that record. `declaration` is the host object itself, kept for the one
// use that needs it — handing a surface back to the library that owns it. Reading it anywhere
// else puts the host material back in the middle of a number the engine computes.
// The keys are paths under `packages/sdk-browser/`, extension dropped. The benches are not keyed:
// every file under `BENCH_READS_DECLARATION` reads it, since a bench builds the page records the
// engine path then reads and the witness repaints from them.
export const BENCH_READS_DECLARATION = /^bench\/(?:witnesses|oracles|perf)\//

export const DECLARATION: Record<string, string> = {
  'page/surface': 'boundary: a record wears a new declaration, its surface read with it',
}
