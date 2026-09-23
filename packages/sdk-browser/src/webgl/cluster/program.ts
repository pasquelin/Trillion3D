import { CLUSTER_FRAGMENT, CLUSTER_VERTEX } from './shaders.ts';
import { createWebglProgram } from '../core/program.ts';

export function createClusterProgram(gl: WebGL2RenderingContext) {
  return createWebglProgram(gl, CLUSTER_VERTEX, CLUSTER_FRAGMENT);
}
