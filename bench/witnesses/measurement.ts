/**
 * THE WITNESS ENTRY. The engine's measurement seam (`packages/sdk-browser/src/measurement/measurement.ts`)
 * with the witnesses plugged in: the backends written with the host library that the engine is
 * compared against, frame by frame. They live beside the bench and never in the published package:
 * `scripts/build-witnesses.ts` bundles this file alone into `dist/witnesses/measurement.js`, the
 * engine modules it names staying the dist's own files, and the package's `files` leave it out.
 */
export * from '../../packages/sdk-browser/src/measurement/measurement.ts';
// The light group the bench's witness page builds (`../runner/witnessPage.ts`) is of the graph.
export { GraphGroup } from '../../packages/sdk-browser/src/host/graph/mesh.ts';
export { GraphLight } from '../../packages/sdk-browser/src/host/graph/light.ts';
export { referenceBackend } from './referenceBackend.ts';
export { exactPagesBackend } from './exact/backend.ts';
export { threeLodBackend } from './three/lod.ts';
