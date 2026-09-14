/** Runtime LOD presets. pixelError is the screen-space threshold consumed by exact-cluster selection; 0 keeps exact leaves. */
export const LOD_QUALITY = {
  source: {
    id: 'source',
    label: 'Détail source maximal',
    pixelError: 0,
    anisotropy: 'source',
    adaptive: false,
  },
  high: {
    id: 'high',
    label: 'Qualité élevée',
    pixelError: 1,
    anisotropy: 'maximum',
    adaptive: false,
  },
  balanced: {
    id: 'balanced',
    label: 'Qualité équilibrée',
    pixelError: 4,
    anisotropy: 'source',
    adaptive: false,
  },
  adaptive: {
    id: 'adaptive',
    label: 'Mode adaptatif',
    pixelError: 2,
    anisotropy: 'source',
    adaptive: true,
  },
} as const;
export type LodQualityId = keyof typeof LOD_QUALITY;
export function lodQuality(id: string) {
  const value = LOD_QUALITY[id as LodQualityId];
  if (!value) throw new Error(`Unknown LOD quality: ${id}`);
  return value;
}
/** Adaptive threshold rises with camera speed so a moving view may coarsen; a stationary view uses the base pixelError. */
export function adaptivePixelError(base: number, speed: number, radius: number) {
  if (!Number.isFinite(base) || base < 0) throw new Error('Invalid base pixelError');
  if (!Number.isFinite(speed) || speed < 0 || !Number.isFinite(radius) || radius <= 0) return base;
  return base * (1 + Math.min(4, speed / Math.max(radius / 8, 1e-6)));
}
