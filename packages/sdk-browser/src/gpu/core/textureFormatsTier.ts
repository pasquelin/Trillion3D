import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { gpuCapsOf, gpuCapsOfFeatures } from './gpuCaps.ts'

/**
 * THE STORAGE TEXTURES OF THE FORMATS THE CORE OF WEBGPU DOES NOT GIVE, which two device features
 * and one WGSL language extension carry:
 * - `texture-formats-tier1` (§ 25.19 of the specification, https://www.w3.org/TR/webgpu/#texture-formats-tier1)
 *   lets a compute pass store to, and read, the 8-bit one- and two-channel formats and the 11-11-10
 *   one (`r8unorm`, `rg8unorm`, `rg8uint`, `rg11b10ufloat`…) as `"write-only"` and `"read-only"`
 *   storage textures; it carries `rg11b10ufloat-renderable` (§ 25.12).
 * - `texture-formats-tier2` (§ 25.20, https://www.w3.org/TR/webgpu/#texture-formats-tier2) adds
 *   `"read-write"` for `r8unorm`; it implies the first (§ 3.6.1.2, "Feature Dependencies"; the
 *   format's row in § 26.1.1 "Plain color formats" says the same).
 * - In WGSL the formats need the language extension `texture_formats_tier1` (§ 6.6.1 "Texel
 *   Formats", https://www.w3.org/TR/WGSL/#texel-formats): a language extension is available without
 *   an `enable` — which takes enable-extensions only (§ 4.1.1) — and a program that uses it
 *   documents it with `requires` (§ 4.1.2), `TEXTURE_FORMATS_TIER1_WGSL`, the one block of it.
 *
 * The global distance field's page atlas is an `r8unorm` storage texture where the device grants
 * the second feature: composited in place, read with the hardware's trilinear filter; a device
 * without it keeps the atlas as a buffer of bytes (`../../lighting/distanceField/atlasFetchWgsl.ts`).
 * The temporal history keeps its colour in `rg11b10ufloat` where the first is granted
 * (`../../post/taa/historyShape.ts`). The session requests both when the adapter has them
 * (`../../session/gpuDevice.ts`); the host test switch `trillion3dGpuFeaturesOff` names them off.
 * The two features are `FEATURE.textureTier1` and `FEATURE.textureTier2` (`gpuCaps.ts`).
 */

/** Whether `device` was granted the read-write storage texture of 8-bit formats. */
export const hasTextureFormatsTier2 = (device: Pick<GPUDevice, 'features'>) =>
  gpuCapsOf(device).textureTier >= 2

/** Whether `features`, a device's, hold the storage textures of the packed 8-bit and 11-11-10 formats. */
export const hasTextureFormatsTier1 = (features: { has(name: string): boolean }) =>
  gpuCapsOfFeatures(features).textureTier >= 1

/** The module directive a program that binds a storage texture of those formats opens with: the
 *  `requires` of the language extension, never an `enable` (a language extension is no enable-
 *  extension, § 4.1.1 and § 4.1.2 of the WGSL specification). */
export const TEXTURE_FORMATS_TIER1_WGSL = wgslBlock(
  'TEXTURE_FORMATS_TIER1_WGSL',
  [],
  'requires texture_formats_tier1;',
)
