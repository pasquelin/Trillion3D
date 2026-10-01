/**
 * What the WebGL2 core lends the impostor family's card draw (#1336): the cluster program's
 * fragments and their variant, its program, uniform and sampler set-up, its float textures, units
 * and byte count. The tier (`code.ts`) hands this module to the family when it makes it, and the
 * family reads its types alone: imported by the family, these core modules would be shared by its
 * chunk and split the CDN core into more chunks, which gzip worse (`check-bundle-size.ts`).
 */
import { SUBSURFACE_UNIT } from '../cluster/materialMaps.ts';

export { CLUSTER_FRAGMENT, CLUSTER_LINEAR_FRAGMENT, variant } from '../cluster/shaders.ts';
export { createWebglProgram } from '../core/program.ts';
export { setClusterSamplers, uniformLocations } from '../cluster/uniforms.ts';
export { FLOAT_TEXELS, LIGHT_ROW_TEXELS, WebglLightTexture } from '../cluster/lightTexture.ts';
export { sentBytes } from '../cluster/sentBytes.ts';
export { ROUGHNESS_FLOOR } from '../../lighting/shaderConstants.ts';

/** The units of the card records and of the three atlas maps: past every unit the cluster program
 *  binds (`setClusterSamplers`, the subsurface map last), so a card draw leaves its bindings as
 *  they were. */
export const CARD_RECORD_UNIT = SUBSURFACE_UNIT + 1;
export const ATLAS_UNITS = [CARD_RECORD_UNIT + 1, CARD_RECORD_UNIT + 2, CARD_RECORD_UNIT + 3];
