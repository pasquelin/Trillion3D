import type { GpuSunFarShadow } from './gpuSunFarShadow.ts';

/**
 * L'état de l'ombre lointaine du soleil : le bloc de réglages et de compteurs, le proxy qu'il
 * traverse, et pourquoi il n'y en a pas quand il n'y en a pas. Rien n'est alloué par image.
 */
export interface WebgpuSunFarState {
  gpu: GpuSunFarShadow | undefined;
  /** Le chargement du proxy résident en cours ; il n'est lancé qu'une fois, à la première lampe. */
  pending: Promise<unknown> | undefined;
  /** Vrai quand le proxy traversé est celui de la lumière qui rebondit, emprunté et non rechargé. */
  borrowed: boolean;
  /** Pourquoi l'ombre lointaine n'existe pas, quand elle n'existe pas. */
  reason: string | null;
  published: boolean;
}

export function createWebgpuSunFarState(): WebgpuSunFarState {
  return { gpu: undefined, pending: undefined, borrowed: false, reason: null, published: false };
}
