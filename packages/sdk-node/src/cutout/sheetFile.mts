import { CUTOUT_SHEET_FILE } from '../../../sdk-core/src/index.ts';

/**
 * The cutout answer sheet a compile leaves beside every model, read and written.
 *
 * The compiler classifies a material as a cutout only when this sheet answers `cutout: true` for
 * the texture's image; it never guesses. An answer is keyed by the sha256 of the image bytes, so
 * one answer covers every model that shares that texture — which is why the sheets are read as a
 * batch and written as a batch.
 */
export const SHEET_FILE = CUTOUT_SHEET_FILE;
