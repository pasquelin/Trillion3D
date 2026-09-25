import { EffectPass } from './chain.ts';

/** What a page may pass to `effect.bloom`. */
export interface BloomOptions {
  /** Share of the image replaced by its glow, from 0 (none) to 1 (only the glow). */
  intensity?: number;
  /** Spread of the glow at every level, in texels of that level; 1 is the published filter. */
  radius?: number;
}

/**
 * The published defaults (Jimenez, SIGGRAPH 2014): a 4 % blend of the glow and a one-texel tent.
 * Neither is read from a scene; both are the page's to change.
 */
const BLOOM_DEFAULTS = { intensity: 0.04, radius: 1 };

const checkIntensity = (value: number) => {
  if (!(value >= 0 && value <= 1)) throw new RangeError(`BLOOM_INTENSITY:${value}`);
  return value;
};
const checkRadius = (value: number) => {
  if (!(value > 0 && Number.isFinite(value))) throw new RangeError(`BLOOM_RADIUS:${value}`);
  return value;
};

/**
 * Light that spills around what is bright, as a lens spreads it. Physically based: it runs on the
 * scene's linear radiance, before tone mapping, with no threshold, and it conserves energy — the
 * glow is a blurred copy of the image blended in, so the total light stays what it was.
 */
export class Bloom extends EffectPass {
  readonly kind = 'bloom';
  readonly stage = 'before-tone-mapping';
  private blend: number;
  private spread: number;
  constructor(options: BloomOptions = {}) {
    super();
    this.blend = checkIntensity(options.intensity ?? BLOOM_DEFAULTS.intensity);
    this.spread = checkRadius(options.radius ?? BLOOM_DEFAULTS.radius);
  }
  /** Share of the image replaced by its glow, from 0 to 1. */
  get intensity() {
    return this.blend;
  }
  set intensity(value: number) {
    this.blend = checkIntensity(value);
    this.changed();
  }
  /** Spread of the glow at every level, in texels of that level; above 0. */
  get radius() {
    return this.spread;
  }
  set radius(value: number) {
    this.spread = checkRadius(value);
    this.changed();
  }
}
