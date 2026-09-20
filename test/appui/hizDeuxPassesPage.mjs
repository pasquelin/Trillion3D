// Page side of the proof "two-phase Hi-Z: the previous pyramid withdraws, the still view holds".
//
// The camera first sees the far slab beside the wall (its clusters are drawn, hence occluders
// of the next image), then steps back in front of the wall, where the slab is hidden. The first
// image there still draws the slab's rows in the main pass — last image's pyramid, read with
// last image's rectangles, does not hide them — and its own pyramid then does: the next image
// withdraws them (`retiresParLaPyramide`), the post pass rejects them, and they stay rejected.
// Temporal antialiasing is ON: its jitter is what once made rows trade halves every image, and
// the image must still be held. Each held image is compared to a fresh engine's at the same pose.
import { webgpuPagesBackend } from '../../packages/sdk-browser/webgpuPages.ts';
import {
  cameraFace,
  comptesEtape,
  difference,
  image,
  libere,
  engine,
} from './preuveSceneCommune.mjs';
import { dallePixels, sceneOccultante, surSceneOccultante } from './sceneOccultante.mjs';

const LIMITE = 64;
const options = { stageProfile: true, temporalAntialiasing: true };

/** Renders `camera` until the engine holds the image, at most `LIMITE` images. Returns the
 *  held image, the images it took, and the largest withdrawal and rejection sampled meanwhile. */
async function jusquaTenue(backend, camera) {
  let retires = 0,
    rejetees = 0,
    derniere;
  for (let i = 0; i < LIMITE; i++) {
    derniere = await image(backend, camera);
    const partition = comptesEtape(backend, 'partition');
    retires = Math.max(retires, partition?.retiresParLaPyramide ?? 0);
    rejetees = Math.max(rejetees, derniere.metriques.hizRejectedClusters ?? 0);
    if (derniere.metriques.frameHeld) return { ...derniere, images: i + 1, retires, rejetees };
  }
  return { ...derniere, images: null, retires, rejetees };
}

/** The same pose on an engine that has never seen another: the witness of the held image. */
async function poseNeuve(device, x, onDiag) {
  const scene = sceneOccultante();
  const { backend, canvas } = engine(webgpuPagesBackend, scene, device, onDiag, options);
  try {
    await backend.prepare();
    return (await jusquaTenue(backend, cameraFace(x))).pixels.slice();
  } finally {
    libere(backend, canvas, scene);
  }
}

export async function executer() {
  return surSceneOccultante(options, async (backend, device, onDiag, etapes) => {
    // The slab beside the wall, then hidden behind it, then beside it again.
    for (const x of [1.4, 0, 1.4]) {
      const tenue = await jusquaTenue(backend, cameraFace(x));
      const temoin = await poseNeuve(device, x, onDiag);
      etapes.push({
        x,
        images: tenue.images,
        retires: tenue.retires,
        rejetees: tenue.rejetees,
        dalle: dallePixels(tenue.pixels),
        ecart: difference(tenue.pixels, temoin),
        lignes: comptesEtape(backend, 'partition')?.lignes ?? null,
      });
    }
  });
}
