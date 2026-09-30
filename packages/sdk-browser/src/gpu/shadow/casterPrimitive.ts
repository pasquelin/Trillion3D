/**
 * A shadow caster's primitive state with depth clipping disabled on a device that grants
 * `depth-clip-control` (#26). The hardware clips a near or far sun caster's triangle against the
 * plane and mints corners between the snapped ones, whose f32 sum with the pool origin rounds
 * differently at every origin the pool places the page at; with clipping off z is clamped and no
 * such corner is minted. The x/y clip corners are already origin-independent. A device without the
 * feature keeps the default, clipping.
 */
export function casterPrimitive(device: GPUDevice, base: GPUPrimitiveState): GPUPrimitiveState {
  return device.features.has('depth-clip-control') ? { ...base, unclippedDepth: true } : base;
}
