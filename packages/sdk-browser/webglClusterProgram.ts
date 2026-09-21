import { CLUSTER_FRAGMENT, CLUSTER_VERTEX } from './webglClusterShaders.ts';
import { createWebglProgram } from './webglProgram.ts';

export function createClusterProgram(gl: WebGL2RenderingContext) {
  return createWebglProgram(gl, CLUSTER_VERTEX, CLUSTER_FRAGMENT);
}
