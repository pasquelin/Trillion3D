import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/**
 * The 64-bit atomic maximum WebGPU offers as an optional feature: `atomic<vec2<u32>>` in a storage
 * buffer, a 64-bit unsigned integer whose low 32 bits are the first component and whose high 32
 * bits the second, `atomicStoreMax` taking the greater of the word held and the one given, store
 * only (WGSL §17.8.6, https://www.w3.org/TR/WGSL/#atomic-store-max; the device feature is
 * §25.25 of https://www.w3.org/TR/webgpu/#dom-gpufeaturename-atomic-vec2u-min-max). The
 * visibility write takes its (depth, identifier) pair in one such word where the device grants
 * it (`../../visibility/raster/pixelWgsl.ts`); a device that does not keeps the two-phase write
 * and the hardware depth test. The session requests the feature when the adapter has it
 * (`../../session/gpuDevice.ts`); the host test switch `trillion3dGpuFeaturesOff` names it off.
 */
const WIDE_ATOMIC_NAME: string = 'atomic-vec2u-min-max'
/** The device feature name; the installed type list of `GPUFeatureName` predates it. */
export const WIDE_ATOMIC_FEATURE = WIDE_ATOMIC_NAME as GPUFeatureName

/** Whether `device` was granted the 64-bit atomic maximum (`WIDE_ATOMIC_FEATURE`). */
export const hasWideAtomics = (device: GPUDevice) => device.features.has(WIDE_ATOMIC_NAME)

/** The module directive a program that uses `atomic<vec2<u32>>` opens with. */
export const WIDE_ATOMIC_WGSL = wgslBlock('WIDE_ATOMIC_WGSL', [], 'enable atomic_vec2u_min_max;')
