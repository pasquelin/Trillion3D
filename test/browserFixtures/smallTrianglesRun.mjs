import { setup } from './smallTrianglesSetup.mjs';

export async function run() {
  const {
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
  } = await setup();
  const samples = [];
  for (const sample of [
    {
      name: 'selection disabled',
      pageRows: 1,
      enabled: false,
      fine: false,
      coarse: false,
      shift: 0,
    },
    {
      name: 'resident coarse rejected',
      pageRows: 2,
      enabled: true,
      fine: true,
      coarse: false,
      shift: 0,
    },
    {
      name: 'resident fine rejected',
      pageRows: 2,
      enabled: true,
      fine: false,
      coarse: true,
      shift: 0,
    },
    {
      name: 'all resident pages rejected',
      pageRows: 2,
      enabled: true,
      fine: false,
      coarse: false,
      shift: 0,
    },
    {
      name: 'moving selection returns to fine',
      pageRows: 2,
      enabled: true,
      fine: true,
      coarse: false,
      shift: 0.25,
    },
  ]) {
    maskData.fill(1);
    maskData[maskOffset + 5] = Number(sample.fine);
    maskData[maskOffset + 1] = Number(sample.coarse);
    device.queue.writeBuffer(mask, 0, maskData);
    uniformData[12] = sample.shift;
    uniformWords[22] = maskOffset;
    uniformWords[23] = Number(sample.enabled);
    device.queue.writeBuffer(uniform, 0, uniformData);
    const encoder = device.createCommandEncoder();
    const clear = encoder.beginRenderPass({
      colorAttachments: [
        { view: ids.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] },
      ],
      depthStencilAttachment: {
        view: depth.createView(),
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });
    clear.end();
    raster.encode(encoder, {
      indices,
      positions,
      pages,
      hizFlags: flags,
      uniform,
      uvs,
      maps: maps.createView({ dimension: '2d-array' }),
      sampler: device.createSampler(),
      pageRows: sample.pageRows,
      maxTriangles: 1,
      idsView: ids.createView(),
      depthView: depth.createView(),
      selection: sample.enabled ? { maskBuffer: mask, maskOffset } : undefined,
      groups: new Array(8),
      groupKey: 0,
    });
    encoder.copyTextureToBuffer({ texture: ids }, { buffer: readback, bytesPerRow: row }, [32, 32]);
    encoder.copyTextureToBuffer(
      { texture: depth },
      { buffer: depthReadback, bytesPerRow: row },
      [32, 32],
    );
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    await Promise.all([
      readback.mapAsync(GPUMapMode.READ),
      depthReadback.mapAsync(GPUMapMode.READ),
    ]);
    const idsData = new DataView(readback.getMappedRange()),
      depthData = new DataView(depthReadback.getMappedRange());
    const pixel = (x, y) => idsData.getUint32(y * row + x * 4, true),
      x = 16 + sample.shift * 16;
    samples.push({
      name: sample.name,
      centerId: pixel(x, 16),
      outerId: pixel(0, 0),
      oldCenterId: pixel(16, 16),
      centerDepth: depthData.getFloat32(16 * row + x * 4, true),
    });
    readback.unmap();
    depthReadback.unmap();
  }
  const validation = await device.popErrorScope();
  const output = {
    shaderErrors,
    validation: validation?.message ?? null,
    errors,
    samples,
    adapter: adapter.info,
  };
  raster.dispose();
  device.destroy();
  return output;
}
