type ShadeBindingOptions = {
  device: GPUDevice;
  group?: GPUBindGroup;
  layout?: GPUBindGroupLayout;
  visView?: GPUTextureView;
  cacheBuffer?: GPUBuffer;
  concatPos?: GPUBuffer;
  concatUv?: GPUBuffer;
  concatNrm?: GPUBuffer;
  pageTable?: GPUBuffer;
  mapsTexture?: GPUTexture;
  dataMapsTexture?: GPUTexture;
  mapsSampler?: GPUSampler;
  shadeUniform?: GPUBuffer;
  mapsArrayView?: GPUTextureView;
  dataMapsArrayView?: GPUTextureView;
};

/** Reuses the material resolve bindings until their underlying buffers change. */
export function ensureWebgpuShadeBindings(options: ShadeBindingOptions) {
  let { group, mapsArrayView, dataMapsArrayView } = options;
  const {
    device,
    layout,
    visView,
    cacheBuffer,
    concatPos,
    concatUv,
    concatNrm,
    pageTable,
    mapsTexture,
    dataMapsTexture,
    mapsSampler,
    shadeUniform,
  } = options;
  if (
    !group &&
    layout &&
    visView &&
    cacheBuffer &&
    concatPos &&
    concatUv &&
    concatNrm &&
    pageTable &&
    mapsTexture &&
    dataMapsTexture &&
    mapsSampler &&
    shadeUniform
  ) {
    mapsArrayView ??= mapsTexture.createView({ dimension: '2d-array' });
    dataMapsArrayView ??= dataMapsTexture.createView({ dimension: '2d-array' });
    group = device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: visView },
        { binding: 1, resource: { buffer: cacheBuffer } },
        { binding: 2, resource: { buffer: concatPos } },
        { binding: 3, resource: { buffer: concatUv } },
        { binding: 4, resource: { buffer: concatNrm } },
        { binding: 5, resource: { buffer: pageTable } },
        { binding: 6, resource: mapsArrayView },
        { binding: 7, resource: mapsSampler },
        { binding: 8, resource: { buffer: shadeUniform } },
        { binding: 9, resource: dataMapsArrayView },
      ],
    });
  }
  return { shadeBindGroup: group, mapsArrayView, dataMapsArrayView };
}
