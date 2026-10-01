import type { WorldOptions } from '../core/worldOptions.ts';
/** Choose the XR-compatible context before the canvas permanently acquires one. */
export function xrWorldOptions(
  options: WorldOptions,
  gpuBinding = 'XRGPUBinding' in globalThis,
): WorldOptions {
  if (!options.xr || options.renderer || gpuBinding) return options;
  return { ...options, renderer: 'webgl2' };
}
export function xrRendererCompatible(renderer: string | null, xrCompatible = false) {
  return renderer === 'webgpu'
    ? xrCompatible && 'XRGPUBinding' in globalThis
    : renderer === 'webgl2' && 'XRWebGLLayer' in globalThis;
}
