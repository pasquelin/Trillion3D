import { CLUSTER_FRAGMENT, CLUSTER_LINEAR_FRAGMENT, CLUSTER_VERTEX } from './shaders.ts';
import { createWebglProgram } from '../core/program.ts';

/** The cluster program; with `attributes`, the effect chain's linear variant, reading its vertex
 *  arrays at the display program's attribute locations. */
export function createClusterProgram(
  gl: WebGL2RenderingContext,
  attributes?: Readonly<Record<string, number>>,
) {
  if (!attributes) return createWebglProgram(gl, CLUSTER_VERTEX, CLUSTER_FRAGMENT);
  return createWebglProgram(gl, CLUSTER_VERTEX, CLUSTER_LINEAR_FRAGMENT, attributes);
}
