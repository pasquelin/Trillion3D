import { FULLSCREEN_VERTEX } from './deferredLighting.ts';

const PRESENT_SHADER = `@group(0) @binding(0) var image:texture_2d<f32>;
${FULLSCREEN_VERTEX}
@fragment fn present(@builtin(position) pixel:vec4f)->@location(0) vec4f{return textureLoad(image,vec2i(pixel.xy),0);}`;
/** Source is already display encoded. No second tone map or color conversion. */
export function createGpuPresenter(device: GPUDevice, canvas: HTMLCanvasElement) {
  const context = canvas.getContext('webgpu');
  if (!context) throw new Error('WEBGPU_CANVAS_UNAVAILABLE');
  const format: GPUTextureFormat = 'bgra8unorm';
  context.configure({ device, format, alphaMode: 'opaque', colorSpace: 'srgb' });
  try {
    const layout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'unfilterable-float' },
        },
      ],
    });
    const module = device.createShaderModule({ code: PRESENT_SHADER });
    const pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module, entryPoint: 'fullscreen' },
      fragment: { module, entryPoint: 'present', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });
    let texture: GPUTexture | undefined, group: GPUBindGroup | undefined;
    const targetView = (width: number, height: number) => {
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      return context.getCurrentTexture().createView();
    };
    return {
      canvas,
      targetView,
      present(encoder: GPUCommandEncoder, image: GPUTexture, width: number, height: number) {
        const view = targetView(width, height);
        if (texture !== image) {
          texture = image;
          group = device.createBindGroup({
            layout,
            entries: [{ binding: 0, resource: image.createView() }],
          });
        }
        const pass = encoder.beginRenderPass({
          label: 'WG direct present',
          colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, group!);
        pass.draw(3);
        pass.end();
      },
      dispose() {
        context.unconfigure();
        group = undefined;
        texture = undefined;
      },
    };
  } catch (error) {
    context.unconfigure();
    throw error;
  }
}

/** Row pitch of a readback buffer: RGBA8 rows padded to WebGPU's 256-byte alignment. */
export function readbackBytesPerRow(width: number) {
  return Math.ceil((width * 4) / 256) * 256;
}

/** Explicit diagnostic capture only. Copies WebGPU top-left rows to the SDK's bottom-left convention. */
export async function readGpuImage(
  device: GPUDevice,
  texture: GPUTexture,
  width: number,
  height: number,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const bytesPerRow = readbackBytesPerRow(width);
  const buffer = device.createBuffer({
    label: 'WG explicit capture',
    size: bytesPerRow * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  try {
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture },
      { buffer, bytesPerRow, rowsPerImage: height },
      { width, height, depthOrArrayLayers: 1 },
    );
    device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    signal?.throwIfAborted();
    const mapped = new Uint8Array(buffer.getMappedRange()),
      pixels = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++)
      pixels.set(
        mapped.subarray(y * bytesPerRow, y * bytesPerRow + width * 4),
        (height - 1 - y) * width * 4,
      );
    buffer.unmap();
    return pixels;
  } finally {
    buffer.destroy();
  }
}

/** Compatibility for hosts with a synchronous capture API. This isolated WebGL
 * readback is created only on explicit capture(), never by the beauty loop. */
export function createSynchronousCanvasCapture() {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    alpha: false,
    preserveDrawingBuffer: false,
  });
  if (!gl) throw new Error('SYNCHRONOUS_CAPTURE_UNAVAILABLE: await flush before capture');
  const program = gl.createProgram()!,
    texture = gl.createTexture()!,
    vao = gl.createVertexArray()!;
  const shaders: WebGLShader[] = [];
  try {
    for (const [type, source] of [
      [
        gl.VERTEX_SHADER,
        '#version 300 es\nvoid main(){gl_Position=vec4(float((gl_VertexID&1)*4-1),float((gl_VertexID>>1)*4-1),0.,1.);}',
      ],
      [
        gl.FRAGMENT_SHADER,
        '#version 300 es\nprecision highp float;uniform sampler2D image;out vec4 color;void main(){color=texelFetch(image,ivec2(gl_FragCoord.xy),0);}',
      ],
    ] as const) {
      const shader = gl.createShader(type)!;
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(shader) ?? 'CAPTURE_SHADER');
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(program) ?? 'CAPTURE_PROGRAM');
  } catch (error) {
    shaders.forEach((shader) => gl.deleteShader(shader));
    gl.deleteProgram(program);
    gl.deleteTexture(texture);
    gl.deleteVertexArray(vao);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    throw error;
  }
  shaders.forEach((shader) => gl.deleteShader(shader));
  return {
    read(source: HTMLCanvasElement) {
      if (gl.isContextLost()) throw new Error('CAPTURE_CONTEXT_LOST');
      if (canvas.width !== source.width) canvas.width = source.width;
      if (canvas.height !== source.height) canvas.height = source.height;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.disable(gl.DITHER);
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.uniform1i(gl.getUniformLocation(program, 'image'), 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const pixels = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const error = gl.getError();
      if (error !== gl.NO_ERROR) throw new Error(`CAPTURE_WEBGL_ERROR: ${error}`);
      return pixels;
    },
    dispose() {
      gl.deleteTexture(texture);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
