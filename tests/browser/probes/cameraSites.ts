import { surfaceOf } from '../../../packages/sdk-browser/pageSurface.ts';
// Engine sites that read a camera pose, each called by its real code. A site is
// `{ name, cree, mesure }`: `cree()` returns the state of a frame sequence (Hi-Z hold, cut,
// engine), `mesure(state, camera)` returns as JSON what the site took from the camera for that
// frame.
import * as THREE from 'three';
import { cameraSelectionUniforms } from '../../../packages/sdk-browser/gpuSelection.ts';
import { collectClusterPages } from '../../../packages/sdk-browser/pageSelection.ts';
import { selectVisiblePages } from '../../../packages/sdk-browser/pageSelectionCut.ts';
import { boundsFor, projectBoxesFlat } from '../../../packages/sdk-browser/hizProjection.ts';
import { applyTemporalHiz, sameHizView } from '../../../packages/sdk-browser/hizTemporal.ts';
import type { TemporalHizState } from '../../../packages/sdk-browser/hizTemporal.ts';
import { visibilityDepth } from '../../../packages/sdk-browser/hizDepth.ts';
import { rasterPages } from '../../../packages/sdk-browser/pageRaster.ts';
import { rasterVisibility } from '../../../packages/sdk-browser/visibilityRaster.ts';
import { shadeVisibility } from '../../../packages/sdk-browser/visibilityShade.ts';
import type { VisPage } from '../../../packages/sdk-browser/visibilityTypes.ts';
import type { HizPage } from '../../../packages/sdk-browser/hizTypes.ts';
import { projectedPageError } from '../../../packages/sdk-browser/pageSelectionDiagnostic.ts';
import { resolvePixelError } from '../../../packages/sdk-browser/pageSelectionRequests.ts';
import type { CameraMotion } from '../../../packages/sdk-browser/cameraWorld.ts';
import { dagFixture } from '../../../packages/sdk-browser/pageSelectionDagFixture.ts';
import { sitesMoteurs } from './cameraSitesMoteurs.ts';
import type { Site } from './cameraSitesMoteurs.ts';
import {
  createEngineCamera,
  readCameraWorld,
  type HostCamera,
} from '../../../packages/sdk-browser/cameraWorld.ts';

const VIEWPORT: [number, number] = [1280, 720],
  RASTER: [number, number] = [64, 36];
const liste = (vue: ArrayLike<number>): number[] => Array.from(vue);
/** What a frame input does: the host camera copied into the engine's. Each site remakes it for
 *  itself, like a lone caller. */
const engine = (camera: HostCamera) => readCameraWorld(createEngineCamera(), camera);

/** A page as the Hi-Z and visbuffer sites both need it. */
type VisHizPage = VisPage & HizPage;

/** Pages of the test DAG, in the shape the cut, Hi-Z and rasters read. */
function pagesDag(): { roots: ReturnType<typeof collectClusterPages>['roots']; vis: VisHizPage[] } {
  const fixture = dagFixture();
  const { roots } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  // Dark and metallic: the specular, the only term that reads eye position, stays under 255.
  const material = new THREE.MeshStandardMaterial({
    color: 0x303030,
    metalness: 0.9,
    roughness: 0.35,
    side: THREE.DoubleSide,
  });
  const identite = new THREE.Matrix4();
  const vis: VisHizPage[] = [0, 1, 2, 3].map((t) => ({
    array: new Uint32Array([t * 3, t * 3 + 1, t * 3 + 2]),
    attributes: fixture.geometry.attributes,
    matrix: identite,
    material: surfaceOf(material),
    min: [-2 + t, -0.5, 0],
    max: [-1 + t, 0.5, 0],
  }));
  return { roots, vis };
}

/** Pure sites: none keep state from one frame to the next, except held rectangles. */
const sitesPurs: Site[] = [
  {
    name: 'cameraSelectionUniforms (GPU selection)',
    mesure: (_state, camera: HostCamera) => {
      const u = cameraSelectionUniforms(engine(camera), 1, VIEWPORT);
      return {
        view: liste(u.view),
        planes: liste(u.planes),
        cameraWorld: u.cameraWorld,
        cameraStretch: u.cameraStretch,
      };
    },
  },
  {
    name: 'selectVisiblePages (coupe CPU)',
    cree: pagesDag,
    mesure: (state, camera: HostCamera) => {
      const { roots } = state as ReturnType<typeof pagesDag>;
      return [0, 3.5].map((pixelError) => {
        const cut = selectVisiblePages(roots, engine(camera), { pixelError, viewport: VIEWPORT });
        return { shown: cut.shown.map((p) => p.url).sort(), rejetes: cut.frustumRejected };
      });
    },
  },
  {
    name: 'projectBoxesFlat (Hi-Z, rectangles)',
    cree: pagesDag,
    mesure: (state, camera: HostCamera) => {
      const { vis } = state as ReturnType<typeof pagesDag>;
      const bounds = boundsFor(vis.length);
      projectBoxesFlat(vis, vis.length, engine(camera), VIEWPORT, bounds);
      return liste(bounds);
    },
  },
  {
    // History held by the frame must describe this frame's view: reread at once, it is equal.
    name: 'applyTemporalHiz + sameHizView (Hi-Z, historique)',
    cree: () => ({ ...pagesDag(), history: {} as TemporalHizState }),
    mesure: (state, camera: HostCamera) => {
      const { vis, history } = state as ReturnType<typeof pagesDag> & { history: TemporalHizState };
      const vue = engine(camera);
      const { shown } = applyTemporalHiz(vis, vue, RASTER, history);
      return { shown: shown.length, historiqueEgal: sameHizView(history.camera, vue) };
    },
  },
  {
    name: 'rasterVisibility + visibilityDepth + shadeVisibility (lit CPU raster)',
    cree: pagesDag,
    mesure: (state, camera: HostCamera) => {
      const { vis } = state as ReturnType<typeof pagesDag>;
      const vue = engine(camera);
      const { ids } = rasterVisibility(vis, vue, RASTER);
      const depth = visibilityDepth(ids, vis, vue, RASTER);
      const rgba = shadeVisibility(ids, vis, vue, RASTER);
      return { ids: liste(ids), depth: liste(depth), rgba: liste(rgba) };
    },
  },
  {
    name: 'rasterPages (oracle CPU)',
    cree: pagesDag,
    mesure: (state, camera: HostCamera) => {
      const { vis } = state as ReturnType<typeof pagesDag>;
      return liste(rasterPages(vis, camera, RASTER));
    },
  },
  {
    name: 'projectedPageError (error diagnostic)',
    mesure: (_state, camera: HostCamera) =>
      projectedPageError(
        { lodError: 0.05, sphere: [0.5, 0, 0, 0.6], matrix: new THREE.Matrix4() },
        engine(camera),
        VIEWPORT,
      ),
  },
  {
    name: 'resolvePixelError (camera speed)',
    // Called by every engine just after updating the frame camera: same contract here.
    cree: () => ({ motion: {} as CameraMotion }),
    mesure: (state, camera: HostCamera) => {
      const { motion } = state as { motion: CameraMotion };
      resolvePixelError({ pixelError: 1, lodAdaptive: true }, engine(camera), motion);
      return liste(motion.last ?? []);
    },
  },
];

export const SITES: Site[] = [...sitesPurs, ...sitesMoteurs];

/** A world point run through a column-major 4×4 matrix. */
const applique = (m: ArrayLike<number>, [x, y, z]: number[]): number[] => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
];

/**
 * Residual of render-frame composition. Selection uniforms publish a view WITHOUT translation
 * and the eye world position, which is the origin of that frame: all translation is passed into
 * world matrices, which the engine brings back to this origin. Applying the relative view to a
 * point so brought back must yield, to single-precision rounding, what the absolute view yields
 * of the same point. Non-zero as soon as the published position is not that of the view — an
 * unwalked rig, for example: it is now what carries the camera move.
 */
export function residuRepereDeRendu(camera: HostCamera): number {
  const cam = engine(camera),
    u = cameraSelectionUniforms(cam, 1, VIEWPORT);
  const sonde = [12, -7, 31];
  const ramene = sonde.map((valeur, i) => valeur - u.cameraWorld[i]);
  const absolu = applique(cam.view, sonde),
    relatif = applique(u.view, ramene);
  return Math.hypot(absolu[0] - relatif[0], absolu[1] - relatif[1], absolu[2] - relatif[2]);
}
