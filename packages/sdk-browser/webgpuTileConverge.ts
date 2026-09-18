import { renderWebgpuPages } from './webgpuPagesRender.ts';
import {
  SHADOWS_PENDING,
  TEXTURES_PENDING,
  unsettledMask,
  unsettledReasons,
} from './webgpuFrameHold.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Tours de convergence au plus : au-delà, ce qui manque est publié, jamais attendu sans fin. */
const CONVERGE_LIMIT = 64;
/** Images qu'une barrière consacre au plus aux pages d'ombre en attente, sous leur budget. Une
 *  caméra immobile dont toutes les pages viennent d'être périmées par une tuile arrivée en prend
 *  quelques-unes ; une caméra qui bouge périme des pages à chaque image et ne converge jamais : la
 *  borne est là pour elle. */
const SHADOW_DRAIN_LIMIT = 64;
/** Allers-retours textures → ombres au plus : chaque tour qui redessine une cascade peut déplacer
 *  ce que l'ombre demande aux textures, et chaque tuile arrivée périme les ombres. */
const POSE_ROUNDS = 4;

/**
 * Fait converger les textures d'une pose : l'image est rendue avec tous ses pixels au retour, ce
 * qu'ils demandent est servi sans budget, et l'on recommence jusqu'à ce qu'aucune tuile demandée ne
 * manque. Une tuile dont le niveau se lit encore est attendue ; une tuile qu'aucune place ne peut
 * accueillir — le pool est plein de tuiles regardées dans cette image — ne l'est pas : le tour
 * s'arrête, et `textureTilesRefused` le dit.
 *
 * Rien n'est libéré ici : une tuile reste résidente jusqu'à ce que le pool, plein, cède la moins
 * regardée — la règle de la référence. La barrière libérait ce que la dernière image n'avait pas
 * nommé, et une demande qui vacille d'une image à l'autre — trois tuiles d'une vitre, nommées une
 * image sur sept — entrait et sortait à chaque capture, changeait la révision des ressources et
 * empêchait l'image de se poser. Une tuile en trop ne change aucune lecture : la caméra lit le
 * niveau qu'elle a demandé, et il est résident. Rend le nombre de tuiles servies.
 */
async function convergeTextures(rt: WebgpuPagesRuntime, gpuDevice: GPUDevice) {
  const { vis, run } = rt;
  const textures = vis.textures!;
  // Rien de diffusé — aucune texture, ou toutes dans leur queue — : aucun retour ne peut rien
  // nommer, et l'image n'a pas à être refaite.
  if (textures.feedback.entries === 0) return 0;
  let total = 0;
  for (let round = 0; round < CONVERGE_LIMIT; round++) {
    renderWebgpuPages(rt, run.lastCamera!);
    await gpuDevice.queue.onSubmittedWorkDone();
    await textures.settled();
    const { served, missing } = textures.pump(run.frame, true);
    total += served;
    // Une tuile servie n'est montrée que par l'image suivante : on ne s'arrête que sur une image
    // qui n'a rien demandé de plus, ou sur un manque que rien ne viendra combler.
    if (!served && (!missing || !textures.reading)) break;
    if (missing) await textures.settled();
  }
  return total;
}

/**
 * Vide les cartes d'ombre : les pages en attente — périmées par une tuile arrivée, par une caméra
 * qui a bougé ou par une page de géométrie entrée ou sortie — sont redessinées sous leur budget
 * jusqu'à ce qu'aucune n'attende. Sans cela, deux captures d'une même pose à caméra mobile
 * différaient selon le moment où le budget d'une milliseconde avait laissé la cascade du soleil
 * (témoin A/A à 189 740 px en vue sol, Lumière 6). Rend le nombre d'images vidées.
 */
async function drainShadows(rt: WebgpuPagesRuntime, gpuDevice: GPUDevice) {
  let drains = 0;
  for (; drains < SHADOW_DRAIN_LIMIT && rt.lights.plan.counts.pendingPages > 0; drains++) {
    renderWebgpuPages(rt, rt.run.lastCamera!);
    await gpuDevice.queue.onSubmittedWorkDone();
  }
  return drains;
}

/**
 * Une pose vidée : textures convergées ET ombres vidées, en alternance jusqu'au calme, et le même
 * prédicat que l'image tenue (`unsettledMask`) pour dire si c'est acquis. L'ordre seul ne suffit
 * pas : ce que l'ombre d'un feuillage demande aux textures se lit dans les cascades du soleil
 * (`visibilityShaderShadowRequest.ts`), et une cascade redessinée par le drainage déplace cette
 * demande ; une tuile arrivée, à l'inverse, périme toutes les ombres. Un tour dont le drainage n'a
 * rien redessiné a convergé ses textures sur les cascades finales : c'est l'arrêt.
 *
 * Ces images rejouent la dernière image ordinaire (`textureConverging`) : tous les pixels parlent,
 * l'accumulation temporelle n'avance pas, aucune n'est tenue. Ce que la barrière a fait, et ce qui
 * empêche encore la pose de se poser, part dans un seul diagnostic, `pose-settle`.
 */
export async function settlePose(rt: WebgpuPagesRuntime, gpuDevice: GPUDevice | undefined) {
  const { run, vis, capture, diag } = rt;
  if (!gpuDevice || !run.lastCamera || run.lost || capture.secondaryCamera) return;
  let rounds = 0,
    served = 0,
    drains = 0;
  run.textureConverging = true;
  try {
    for (; rounds < POSE_ROUNDS; rounds++) {
      if (vis.textures) served += await convergeTextures(rt, gpuDevice);
      const drained = await drainShadows(rt, gpuDevice);
      drains += drained;
      if (!drained) break;
    }
  } finally {
    run.textureConverging = false;
  }
  const mask = unsettledMask(rt);
  if (served || drains || mask & (TEXTURES_PENDING | SHADOWS_PENDING))
    diag.engineDiagnostic('pose-settle', 'Ce que la barrière a fait pour poser l’image', {
      rounds,
      tilesServed: served,
      shadowFrames: drains,
      pendingPages: rt.lights.plan.counts.pendingPages,
      reasons: unsettledReasons(mask),
    });
}
