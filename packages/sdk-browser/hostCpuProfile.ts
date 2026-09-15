/**
 * Les bornes qu'un hôte relève lui-même — hors de l'image qu'elles auraient allongée — et dépose
 * sur le moteur. Elles sont nommées, jamais numérotées : chaque moteur les range où il veut dans sa
 * propre table de bornes, et un moteur qui n'en tient pas n'expose simplement rien.
 */
export type HostCpuStep = 'arrivalsMs' | 'pendingMs' | 'retainMs' | 'submitMs';

/** Ce qu'un moteur offre à l'hôte pour le profil par étape, quand il en tient un. */
export interface HostCpuProfile {
  cpuStep?(step: HostCpuStep, ms: number): void;
  cpuFrameEnd?(): void;
  gpuImageMs?(ms: number | null, supported: boolean, reason: string | null): void;
}
