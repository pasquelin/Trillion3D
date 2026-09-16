// Les sites du moteur qui lisent la pose d'une caméra, chacun appelé par son vrai code. Un site est
// `{ nom, cree, mesure }` : `cree()` rend l'état d'une séquence d'images (tenue Hi-Z, coupe, moteur),
// `mesure(état, caméra)` rend en JSON ce que le site a tiré de la caméra pour cette image.
import * as THREE from 'three';
import { cameraSelectionUniforms } from '../../gpuSelection.ts';
import { collectClusterPages } from '../../pageSelection.ts';
import { selectVisiblePages } from '../../pageSelectionCut.ts';
import { boundsFor, projectBoxesFlat } from '../../hizProjection.ts';
import { createProjectionHold } from '../../hizProjectionHold.ts';
import { applyTemporalHiz, sameHizView } from '../../hizTemporal.ts';
import { visibilityDepth } from '../../hizDepth.ts';
import { rasterPages } from '../../pageRaster.ts';
import { rasterVisibility } from '../../visibilityRaster.ts';
import { shadeVisibility } from '../../visibilityShade.ts';
import { projectedPageError } from '../../pageSelectionDiagnostic.ts';
import { resolvePixelError } from '../../pageSelectionRequests.ts';
import { dagFixture } from '../../pageSelectionDagFixture.ts';
import { sitesMoteurs } from './cameraSitesMoteurs.mjs';
import { createEngineCamera, readCameraWorld } from '../../cameraWorld.ts';

const VIEWPORT = [1280, 720],
  RASTER = [64, 36];
const liste = (vue) => Array.from(vue);
/** Ce que fait une entrée d'image : la caméra de l'hôte recopiée dans celle du moteur. Chaque site
 *  la refait pour lui-même, comme un appelant seul. */
const moteur = (camera) => readCameraWorld(createEngineCamera(), camera);

/** Les pages du DAG de test, sous la forme que lisent la coupe, le Hi-Z et les rasters. */
function pagesDag() {
  const fixture = dagFixture();
  const { roots } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  // Sombre et métallique : le spéculaire, seul terme qui lit la position de l'œil, reste sous 255.
  const material = new THREE.MeshStandardMaterial({
    color: 0x303030,
    metalness: 0.9,
    roughness: 0.35,
    side: THREE.DoubleSide,
  });
  const identite = new THREE.Matrix4();
  const vis = [0, 1, 2, 3].map((t) => ({
    array: new Uint32Array([t * 3, t * 3 + 1, t * 3 + 2]),
    attributes: fixture.geometry.attributes,
    matrix: identite,
    material,
    min: [-2 + t, -0.5, 0],
    max: [-1 + t, 0.5, 0],
  }));
  return { roots, vis };
}

/** Sites purs : aucun ne garde d'état d'une image à l'autre, sauf la tenue des rectangles. */
const sitesPurs = [
  {
    nom: 'cameraSelectionUniforms (sélection GPU)',
    mesure: (_, camera) => {
      const u = cameraSelectionUniforms(moteur(camera), 1, VIEWPORT);
      return {
        view: liste(u.view),
        planes: liste(u.planes),
        cameraWorld: u.cameraWorld,
        cameraStretch: u.cameraStretch,
      };
    },
  },
  {
    nom: 'selectVisiblePages (coupe CPU)',
    cree: pagesDag,
    mesure: ({ roots }, camera) =>
      [0, 3.5].map((pixelError) => {
        const cut = selectVisiblePages(roots, moteur(camera), { pixelError, viewport: VIEWPORT });
        return { shown: cut.shown.map((p) => p.url).sort(), rejetes: cut.frustumRejected };
      }),
  },
  {
    nom: 'projectBoxesFlat (Hi-Z, rectangles)',
    cree: pagesDag,
    mesure: ({ vis }, camera) => {
      const bounds = boundsFor(vis.length);
      projectBoxesFlat(vis, vis.length, moteur(camera), VIEWPORT, bounds);
      return liste(bounds);
    },
  },
  {
    nom: 'createProjectionHold.reframe (Hi-Z, tenue)',
    cree: () => ({ hold: createProjectionHold(4), index: new Int32Array([0, 1, 2, 3]) }),
    mesure: ({ hold, index }, camera) => {
      hold.reframe(moteur(camera), VIEWPORT[0], VIEWPORT[1], 0);
      const reprojette = hold.select(4, undefined, index);
      hold.keep(4, index);
      return reprojette;
    },
  },
  {
    // L'historique tenu par l'image doit décrire la vue de cette image : relu aussitôt, il est égal.
    nom: 'applyTemporalHiz + sameHizView (Hi-Z, historique)',
    cree: () => ({ ...pagesDag(), history: {} }),
    mesure: ({ vis, history }, camera) => {
      const vue = moteur(camera);
      const { shown } = applyTemporalHiz(vis, vue, RASTER, history);
      return { shown: shown.length, historiqueEgal: sameHizView(history.camera, vue) };
    },
  },
  {
    nom: 'rasterVisibility + visibilityDepth + shadeVisibility (raster CPU éclairé)',
    cree: pagesDag,
    mesure: ({ vis }, camera) => {
      const vue = moteur(camera);
      const { ids } = rasterVisibility(vis, vue, RASTER);
      const depth = visibilityDepth(ids, vis, vue, RASTER);
      const rgba = shadeVisibility(ids, vis, vue, RASTER);
      return { ids: liste(ids), depth: liste(depth), rgba: liste(rgba) };
    },
  },
  {
    nom: 'rasterPages (oracle CPU)',
    cree: pagesDag,
    mesure: ({ vis }, camera) => liste(rasterPages(vis, camera, RASTER)),
  },
  {
    nom: 'projectedPageError (diagnostic d’erreur)',
    mesure: (_, camera) =>
      projectedPageError(
        { lodError: 0.05, sphere: [0.5, 0, 0, 0.6], matrix: new THREE.Matrix4() },
        moteur(camera),
        VIEWPORT,
      ),
  },
  {
    nom: 'resolvePixelError (vitesse de caméra)',
    // Appelé par chaque moteur juste après la mise à jour de la caméra de l'image : même contrat ici.
    cree: () => ({ motion: {} }),
    mesure: ({ motion }, camera) => {
      resolvePixelError({ pixelError: 1, lodAdaptive: true }, moteur(camera), motion);
      return liste(motion.last);
    },
  },
];

export const SITES = [...sitesPurs, ...sitesMoteurs];
