/**
 * THE WITNESS ENTRY. The engine's measurement seam (`packages/sdk-browser/src/measurement/measurement.ts`)
 * as the bench's pages import it. The witnesses written with the host library are pages
 * of their own (`../runner/witness/threeMeasurePage.ts`), never the engine of a session.
 * This entry lives beside the bench and never in the published package:
 * `scripts/build-witnesses.ts` bundles this file alone into `dist/witnesses/measurement.js`, the
 * engine modules it names staying the dist's own files, and the package's `files` leave it out.
 */
export * from '../../packages/sdk-browser/src/measurement/measurement.ts'
