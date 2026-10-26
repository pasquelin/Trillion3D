import { visShader } from './visWgsl.ts'

/** The raster's module without a diagnostic stage and without a cut at the view's plane: what a view
 *  with no plane draws with, and the text every audit reads; a view with one draws with its twin,
 *  `visShader({ clipping })`. */
export const VIS_SHADER = visShader()
