/** Compiles one shader, or throws its log; the shader is deleted on failure. */
function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) || 'WEBGL_SHADER';
    gl.deleteShader(shader);
    throw new Error(log);
  }
  return shader;
}

/**
 * Links a vertex and a fragment shader into one program of the host context, or throws the
 * link log. The shaders are deleted either way: the program keeps what it needs of them.
 * `attributes` pins attribute locations, so two programs read the same vertex arrays.
 */
export function createWebglProgram(
  gl: WebGL2RenderingContext,
  vertex: string,
  fragment: string,
  attributes?: Readonly<Record<string, number>>,
) {
  const program = gl.createProgram()!;
  const shaders: WebGLShader[] = [];
  try {
    for (const [type, source] of [
      [gl.VERTEX_SHADER, vertex],
      [gl.FRAGMENT_SHADER, fragment],
    ] as const) {
      const shader = compile(gl, type, source);
      shaders.push(shader);
      gl.attachShader(program, shader);
    }
    for (const name in attributes)
      if (attributes[name] >= 0) gl.bindAttribLocation(program, attributes[name], name);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(program) || 'WEBGL_PROGRAM');
  } catch (error) {
    gl.deleteProgram(program);
    throw error;
  } finally {
    for (const shader of shaders) gl.deleteShader(shader);
  }
  return program;
}
