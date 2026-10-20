import { textureBytesOf } from '../../gpu/core/textureBytes.ts'

/** The outline's one target (`webgpuOutline.ts`): for each display pixel, how far across, in
 *  pixels, its row meets the selection — 0 on it —, as `k / 255`; past the line's reach it holds
 *  `reach + 1`. A byte holds every reach the widest line asks (`OUTLINE_MAX_THICKNESS` at the
 *  densest display). No shader text: the core's byte rules read it without the renderer's. */
export const OUTLINE_FORMAT: GPUTextureFormat = 'r8unorm'

/** Bytes of the outline's target on a `width × height` display, whatever the number of outlines:
 *  they draw one after the other on it. */
export const outlineBytes = (width: number, height: number) =>
  textureBytesOf({ size: [width, height], format: OUTLINE_FORMAT }) ?? 0
