import type { Sheet } from './sheet.mts';

type SheetTexture = Sheet['textures'][string];

/**
 * One answer-sheet entry, shared by the cutout tests: the same shape the compiler writes, so a
 * field that moves on one side breaks both at once.
 */
export const leaf = (blendPrimitives: number): SheetTexture => ({
  image: 'feuillage.png',
  used: true,
  measure: { betweenPercent: 4.3, atContourPercent: 99.7, absentPercent: 85.8 },
  blendPrimitives,
  proposal: 'cutout',
  cutout: null,
});
