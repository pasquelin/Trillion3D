import { MAX_REFLECTION_SAMPLES, MAX_EMITTERS, MAX_DIRECT_SAMPLES } from './contracts.ts';
import { lightingSurfaceShader } from '../shader/surface.ts';
import { lightingIntersectionsShader } from '../shader/intersections.ts';
import { lightingTraversalShader } from '../shader/traversal.ts';
import { lightingDirectShader } from '../shader/direct.ts';
import { lightingSpecularShader } from '../shader/specular.ts';

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
