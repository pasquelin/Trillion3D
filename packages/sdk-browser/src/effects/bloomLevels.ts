/**
 * Levels of the chain: six, fewer on an image too small to halve six
 * times — a level is at least one texel. A declared value, not a measured one: it sets how far
 * the widest glow reaches, 2⁶ texels of the image per texel of the last level.
 */
export const BLOOM_LEVELS = 6;
