import {
  MAX_REFLECTION_SAMPLES,
  MAX_EMITTERS,
  MAX_DIRECT_SAMPLES,
} from './lightingObservationContracts.ts';
import { lightingSurfaceShader } from './lightingShaderSurface.ts';
import { lightingIntersectionsShader } from './lightingShaderIntersections.ts';
import { lightingTraversalShader } from './lightingShaderTraversal.ts';
import { lightingDirectShader } from './lightingShaderDirect.ts';
import { lightingSpecularShader } from './lightingShaderSpecular.ts';

export const vertexShader = `
varying vec3 worldPosition;
void main(){
 vec4 world=modelMatrix*vec4(position,1.0);
 worldPosition=world.xyz;
 gl_Position=projectionMatrix*viewMatrix*world;
}`;

export function fragmentShader(surfaceCount: number) {
  return (
    `
#define SURFACE_COUNT ${surfaceCount}
#define BVH_NODE_COUNT ${2 * surfaceCount - 1}
#define MAX_SAMPLES ${MAX_REFLECTION_SAMPLES}
#define MAX_EMITTERS ${MAX_EMITTERS}
#define MAX_DIRECT_SAMPLES ${MAX_DIRECT_SAMPLES}
` +
    lightingSurfaceShader +
    lightingIntersectionsShader +
    lightingTraversalShader +
    lightingDirectShader +
    lightingSpecularShader
  );
}
