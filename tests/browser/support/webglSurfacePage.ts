import { prepareExplorerWebglSurface } from '../../../packages/sdk-browser/explorerWebglHost.ts';

const waitFor = <T>(read: () => T | false | undefined, timeout = 2000) =>
  new Promise<T>((resolve, reject) => {
    const start = performance.now();
    const poll = () => {
      const value = read();
      if (value) resolve(value);
      else if (performance.now() - start >= timeout)
        reject(new Error('WebGL context event timeout'));
      else requestAnimationFrame(poll);
    };
    poll();
  });

function draw(gl: WebGL2RenderingContext, color: number[]) {
  const vertex = gl.createShader(gl.VERTEX_SHADER),
    fragment = gl.createShader(gl.FRAGMENT_SHADER),
    program = gl.createProgram();
  if (!vertex || !fragment || !program) throw new Error('WebGL2 shader objects unavailable');
  gl.shaderSource(
    vertex,
    '#version 300 es\nvoid main(){gl_Position=vec4(-1.+float(gl_VertexID&1)*4.,-1.+float((gl_VertexID>>1)&1)*4.,0.,1.);}',
  );
  gl.shaderSource(
    fragment,
    `#version 300 es\nprecision highp float;out vec4 outColor;void main(){outColor=vec4(${color.join(',')});}`,
  );
  gl.compileShader(vertex);
  gl.compileShader(fragment);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.useProgram(program);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const pixel = new Uint8Array(4);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  gl.deleteProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  return [...pixel];
}

export async function execute() {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const events: ('lost' | 'restored')[] = [];
  const surface = prepareExplorerWebglSurface({
    canvas,
    onLifecycle: (state) => events.push(state),
  });
  surface.resize(32, 16, 2);
  const before = draw(surface.context, [1, 0, 0, 1]);
  surface.resize(32, 16, 2);
  const afterSameSize = new Uint8Array(4);
  surface.context.readPixels(
    0,
    0,
    1,
    1,
    surface.context.RGBA,
    surface.context.UNSIGNED_BYTE,
    afterSameSize,
  );
  surface.resize(16, 8, 2);
  const afterResize = draw(surface.context, [0, 1, 0, 1]);
  const extension = surface.context.getExtension('WEBGL_lose_context');
  if (!extension) return { unavailable: 'WEBGL_lose_context unavailable' };
  extension.loseContext();
  await waitFor(() => events.includes('lost'));
  extension.restoreContext();
  await waitFor(() => events.includes('restored'));
  const afterRestore = draw(surface.context, [0, 0, 1, 1]);
  surface.dispose();
  await waitFor(() => surface.context.isContextLost());
  return {
    size: surface.size,
    before,
    afterSameSize: [...afterSameSize],
    afterResize,
    afterRestore,
    events,
    disposed: surface.disposed,
    contextLostAfterDispose: surface.context.isContextLost(),
  };
}
