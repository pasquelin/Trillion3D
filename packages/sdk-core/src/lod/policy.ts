/** Runtime LOD presets. pixelError is the screen-space threshold consumed by exact-cluster selection; 0 keeps exact leaves. */
export const LOD_QUALITY = {
  /** Every triangle of the source. */
  source: {
    id: 'source',
    label: 'Maximum source detail',
    pixelError: 0,
    anisotropy: 'source',
    adaptive: false,
  },
  /** Detail no one can tell from the source. */
  high: {
    id: 'high',
    label: 'High quality',
    pixelError: 1,
    anisotropy: 'maximum',
    adaptive: false,
  },
  /** A little less detail, for speed. */
  balanced: {
    id: 'balanced',
    label: 'Balanced quality',
    pixelError: 4,
    anisotropy: 'source',
    adaptive: false,
  },
  /** Detail that follows the frame budget. */
  adaptive: {
    id: 'adaptive',
    label: 'Adaptive mode',
    pixelError: 2,
    anisotropy: 'source',
    adaptive: true,
  },
} as const;
/** The name of a detail preset. */
export type LodQualityId = keyof typeof LOD_QUALITY;
/** The detail preset named `id`, or the balanced one. */
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
