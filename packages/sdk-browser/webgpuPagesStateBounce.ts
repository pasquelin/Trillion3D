import type { GpuBounceProbes } from './gpuBounceProbes.ts';

/**
 * L'état de la lumière qui rebondit : la grille de sondes, ce que l'hôte en a demandé, et ce que la
 * dernière image a réellement fait. Rien n'est alloué par image.
 */
export interface WebgpuBounceState {
  probes: GpuBounceProbes | undefined;
  /** Le chargement du proxy résident en cours ; il n'est lancé qu'une fois, à la première lampe. */
  pending: Promise<unknown> | undefined;
  /** Ce que l'hôte a demandé. */
  wanted: boolean;
  /** La durée visée de l'étape « Rebond » par image, en millisecondes : la consigne de l'hôte. */
  budgetMs: number;
  /** Pourquoi le rebond n'existe pas, quand il n'existe pas. */
  reason: string | null;
  /** Révision du magasin de lampes déjà vue : un changement relance la convergence. */
  lightEpoch: number;
  /** Sondes mises à jour et rayons lancés par la dernière image ; zéro quand rien n'a été encodé. */
  probesUpdated: number;
  raysLaunched: number;
  /** Vrai quand la dernière image a réellement encodé la passe de sondes. */
  encoded: boolean;
  firstFrameLogged: boolean;
}

export function createWebgpuBounceState(wanted: boolean, budgetMs: number): WebgpuBounceState {
  return {
    probes: undefined,
    pending: undefined,
    wanted,
    budgetMs,
    reason: null,
    lightEpoch: 0,
    probesUpdated: 0,
    raysLaunched: 0,
    encoded: false,
    firstFrameLogged: false,
  };
}
