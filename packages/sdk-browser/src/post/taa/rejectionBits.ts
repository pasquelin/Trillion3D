/**
 * The bits of the alpha of a render texel's rejection word (`REJECTION_FORMAT`):
 * - `kept`: the history is read, not disoccluded;
 * - `resurrected`: the history is the frame the pixel is resurrected from, not the last image's.
 */
export const REJECTION_BITS = { kept: 1, resurrected: 2 } as const
