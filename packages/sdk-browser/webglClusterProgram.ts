import { CLUSTER_FRAGMENT, CLUSTER_VERTEX } from './webglClusterShaders.ts';

const compile = (gl: WebGL2RenderingContext, type: number, source: string) => {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
    throw new Error(gl.getShaderInfoLog(shader) ?? 'Cluster shader failed');
  return shader;
};

export function createClusterProgram(gl: WebGL2RenderingContext) {
  const program = gl.createProgram()!,
    vertex = compile(gl, gl.VERTEX_SHADER, CLUSTER_VERTEX),
    fragment = compile(gl, gl.FRAGMENT_SHADER, CLUSTER_FRAGMENT);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(program) ?? 'Cluster program failed');
  return program;
}
