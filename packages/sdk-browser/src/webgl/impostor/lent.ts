/**
 * What the WebGL2 core lends the impostor family (#1336, `../../impostor/lent.ts`): the shared
 * pieces, and the cluster program's fragments, program, uniform and sampler set-up, float textures
 * and byte count, and the texture units of the card records and the three atlas maps.
 */
import { SUBSURFACE_UNIT } from '../cluster/materialMaps.ts';

export * from '../../impostor/lent.ts';
export { CLUSTER_FRAGMENT, CLUSTER_LINEAR_FRAGMENT, variant } from '../cluster/shaders.ts';
export { createWebglProgram } from '../core/program.ts';
export { setClusterSamplers, uniformLocations } from '../cluster/uniforms.ts';
export { FLOAT_TEXELS, LIGHT_ROW_TEXELS, WebglLightTexture } from '../cluster/lightTexture.ts';
export { sentBytes } from '../cluster/sentBytes.ts';
export { allocated } from '../core/allocation.ts';
export { ROUGHNESS_FLOOR } from '../../lighting/shaderConstants.ts';

/** The units of the card records and of the three atlas maps: past every unit the cluster program
 *  binds (`setClusterSamplers`, the subsurface map last), so a card draw leaves its bindings as
 *  they were. */
export const CARD_RECORD_UNIT = SUBSURFACE_UNIT + 1;
export const ATLAS_UNITS = [CARD_RECORD_UNIT + 1, CARD_RECORD_UNIT + 2, CARD_RECORD_UNIT + 3];
