import type { SurfaceBuffer } from './surfaceBuffer.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

let attachmentsFor: GPUTextureView[] | undefined,
  attachments: GPURenderPassColorAttachment[] | undefined;

/**
 * Les pièces jointes de couleur des surfaces, gardées telles quelles jusqu'au prochain jeu de vues.
 * Leurs quatre descripteurs ne dépendent que des vues, et les vues ne changent qu'au redimensionnement
 * de la cible : les reconstruire par image allouait cinq objets pour écrire les mêmes champs.
 * `views()` reste appelé à chaque image, c'est lui qui refuse une cible libérée.
 */
export function surfaceColorAttachments(surfaces: SurfaceBuffer) {
  const views = surfaces.views();
  if (attachmentsFor !== views || !attachments) {
    attachments = views.map((view) => ({
      view,
      loadOp: 'clear' as const,
      storeOp: 'store' as const,
      clearValue: [0, 0, 0, 0],
    }));
    attachmentsFor = views;
    withFeedback = undefined;
  }
  return attachments;
}

const feedback: GPURenderPassColorAttachment = {
  view: undefined as unknown as GPUTextureView,
  loadOp: 'clear',
  storeOp: 'store',
};
let withFeedback: GPURenderPassColorAttachment[] | undefined;

/**
 * La pièce jointe de la cible de retour des textures virtuelles, et la seule règle de son ouverture :
 * la première passe de l'image qui l'écrit l'efface, les suivantes la gardent, et `feedbackWritten`
 * dit à la soumission qu'il y a quelque chose à réduire. Résolution opaque et mélange l'appellent
 * toutes deux ; aucune ne sait laquelle passe la première.
 */
export function feedbackAttachment(rt: WebgpuPagesRuntime) {
  feedback.view = rt.gpu.feedbackView as GPUTextureView;
  feedback.loadOp = rt.run.feedbackWritten ? 'load' : 'clear';
  rt.run.feedbackWritten = true;
  return feedback;
}

/** Les surfaces puis la cible de retour : les cinq pièces jointes de la résolution matérielle. */
export function shadeColorAttachments(rt: WebgpuPagesRuntime, surfaces: SurfaceBuffer) {
  const base = surfaceColorAttachments(surfaces);
  withFeedback ??= [...base, feedback];
  feedbackAttachment(rt);
  return withFeedback;
}
