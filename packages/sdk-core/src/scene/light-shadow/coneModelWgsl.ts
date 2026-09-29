import { coneModel, VECTORS_WGSL } from './coneModel.ts';
import { PAGE_OPS_WGSL } from './pageModelWgsl.ts';

const printed = coneModel(PAGE_OPS_WGSL, VECTORS_WGSL);
const face = 'f:vec3f,r:vec3f,u:vec3f,t:f32,halfFov:f32';
const page = 'u0:f32,u1:f32,v0:f32,v1:f32';

/** The cone as the GPU's pages compose it (`freshWgsl.ts`): its axis, then its half-angle. */
export const CONE_MODEL_WGSL = `
fn shadowConeAxis(${face},${page})->vec3f{return ${printed.shadowConeAxis('f', 'r', 'u', 't', 'halfFov', 'u0', 'u1', 'v0', 'v1')};}
fn shadowConeSpread(${face},axis:vec3f,${page})->f32{return ${printed.shadowConeSpread('f', 'r', 'u', 't', 'halfFov', 'axis', 'u0', 'u1', 'v0', 'v1')};}`;
