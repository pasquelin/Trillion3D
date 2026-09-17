export async function setup() {
  const { createGpuRaster } = await import('/packages/sdk-browser/gpuRaster.ts');
  const { VIS_SHADER } = await import('/packages/sdk-browser/visibilityBuffer.ts');
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) throw new Error('WEBGPU_ADAPTER_UNAVAILABLE');
  const device = await adapter.requestDevice();
  const errors = [];
  device.addEventListener('uncapturederror', (event) => errors.push(event.error.message));
  const module = device.createShaderModule({ code: VIS_SHADER });
  const compilation = await module.getCompilationInfo();
  const shaderErrors = compilation.messages
    .filter((message) => message.type === 'error')
    .map((message) => message.message);
  const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
  const write = (values, size = values.byteLength) => {
    const buffer = device.createBuffer({ size: Math.max(4, size), usage: storage });
    device.queue.writeBuffer(buffer, 0, values);
    return buffer;
  };
  const indices = write(new Uint32Array([0, 1, 2]));
  const positions = write(new Float32Array([-0.1, -0.1, 0.5, 0.1, -0.1, 0.5, 0, 0.1, 0.5]));
  const uvs = write(new Float32Array(6));
  const flags = write(new Uint32Array([0]));
  const pageData = new ArrayBuffer(2 * 256),
    f = new Float32Array(pageData),
    u = new Uint32Array(pageData);
  for (let page = 0; page < 2; page++) {
    const base = page * 64;
    f.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, page ? -0.25 : 0, 1], base);
    f[base + 19] = 1;
    u[base + 23] = 2;
    u[base + 25] = 3;
    u[base + 27] = (page + 1) << 16;
    f[base + 28] = 1;
    f[base + 29] = 1;
    u[base + 31] = 0xffffffff;
    // Packed selection IDs deliberately differ from table rows and mask offsets.
    u[base + 47] = page ? 1 : 5;
  }
  const pages = write(new Uint8Array(pageData));
  const uniformData = new Float32Array(24),
    uniformWords = new Uint32Array(uniformData.buffer);
  uniformData.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  uniformData[16] = 32;
  uniformData[17] = 32;
  uniformData[18] = 7;
  const uniform = device.createBuffer({
    size: 96,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const maskOffset = 3,
    maskData = new Uint32Array(maskOffset + 6),
    mask = write(maskData);
  const maps = device.createTexture({
    size: { width: 1, height: 1, depthOrArrayLayers: 2 },
    format: 'rgba8unorm-srgb',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  device.queue.writeTexture(
    { texture: maps, origin: [0, 0, 0] },
    new Uint8Array([255, 255, 255, 255]),
    { bytesPerRow: 4 },
    [1, 1],
  );
  const ids = device.createTexture({
    size: [32, 32],
    format: 'r32uint',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const depth = device.createTexture({
    size: [32, 32],
    format: 'depth32float',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  device.pushErrorScope('validation');
  const raster = createGpuRaster(device, 32, 32, 2);
  const row = 256,
    readback = device.createBuffer({
      size: row * 32,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
  const depthReadback = device.createBuffer({
    size: row * 32,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  return {
    adapter,
    device,
    errors,
    shaderErrors,
    indices,
    positions,
    uvs,
    flags,
    pages,
    uniformData,
    uniformWords,
    uniform,
    maskOffset,
    maskData,
    mask,
    maps,
    ids,
    depth,
    raster,
    row,
    readback,
    depthReadback,
  };
}
