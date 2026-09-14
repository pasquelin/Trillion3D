type VisibilityBindingOptions = {
  device: GPUDevice;
  layout?: GPUBindGroupLayout;
  cacheBuffer?: GPUBuffer;
  concatPos?: GPUBuffer;
  concatUv?: GPUBuffer;
  pageTable?: GPUBuffer;
  visUniform?: GPUBuffer;
  zeroFlags?: GPUBuffer;
  mapsTexture?: GPUTexture;
  mapsSampler?: GPUSampler;
  hizFlags?: GPUBuffer;
  mapsArrayView?: GPUTextureView;
  visBindGroup?: GPUBindGroup;
  visHizBindGroup?: GPUBindGroup;
};

/** Binds row visibility inputs once for untested and Hi-Z-tested passes. */
export function ensureWebgpuVisibilityBindings(options: VisibilityBindingOptions) {
  let { mapsArrayView, visBindGroup, visHizBindGroup } = options;
  const {
    device,
    layout,
    cacheBuffer,
    concatPos,
    concatUv,
    pageTable,
    visUniform,
    zeroFlags,
    mapsTexture,
    mapsSampler,
    hizFlags,
  } = options;
  if (
    layout &&
    cacheBuffer &&
    concatPos &&
    concatUv &&
    pageTable &&
    visUniform &&
    zeroFlags &&
    mapsTexture &&
    mapsSampler
  ) {
    mapsArrayView ??= mapsTexture.createView({ dimension: '2d-array' });
    const make = (flags: GPUBuffer) =>
      device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer: cacheBuffer } },
          { binding: 1, resource: { buffer: concatPos } },
          { binding: 2, resource: { buffer: pageTable } },
          { binding: 3, resource: { buffer: flags } },
          { binding: 4, resource: { buffer: visUniform, offset: 0, size: 96 } },
          { binding: 5, resource: { buffer: concatUv } },
          { binding: 6, resource: mapsArrayView! },
          { binding: 7, resource: mapsSampler },
          { binding: 8, resource: { buffer: zeroFlags } },
          { binding: 9, resource: { buffer: zeroFlags } },
        ],
      });
    visBindGroup ??= make(zeroFlags);
    if (hizFlags) visHizBindGroup ??= make(hizFlags);
  }
  return { mapsArrayView, visBindGroup, visHizBindGroup };
}
