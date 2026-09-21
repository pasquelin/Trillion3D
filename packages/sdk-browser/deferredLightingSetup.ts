import { PROBE_FLOATS, SHADOW_SLICE_FLOATS } from '../sdk-core/index.ts';
import { BOUNCE_GRID_BYTES } from './bounceUniform.ts';
import { PROXY_HEADER_BYTES } from './bounceNodeWgsl.ts';
import { SUN_FAR_PROXY_BINDING } from './sunFarShadowWgsl.ts';
import { DEPTH_COMPARE } from './depthConvention.ts';

/**
 * Substitute of the resident proxy: a header of zeros and four words behind it. Presence
 * is zero there, node count too, so no distant-shadow ray is fired and the distant surface
 * stays lit exactly as before that ray existed.
 */
const PLACEHOLDER_PROXY_BYTES = PROXY_HEADER_BYTES + 16;

/**
 * Bindings of the deferred pass. The unlit view stops at the surfaces and the uniform;
 * the contract program adds the declared lights, their per-tile lists, their shadow slices
 * and the atlas; the bounce one adds the probe grid. None of the three reads a light written
 * in the scene: there is none left. The water composite extends the full list with its own
 * bindings, so a surface lit there is read on the same numbers.
 */
export function deferredLayoutEntries(
  direct: boolean,
  bounce = false,
  proxy: GPUBufferBindingLayout = { type: 'storage' },
) {
  const entries: GPUBindGroupLayoutEntry[] = [0, 1, 2, 3, 4].map((binding) => ({
    binding,
    visibility: GPUShaderStage.FRAGMENT,
    texture: {
      sampleType: binding === 3 ? 'uint' : binding === 4 ? 'depth' : 'unfilterable-float',
    },
  }));
  entries.push({ binding: 5, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } });
  if (direct)
    entries.push(
      { binding: 6, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 7, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 8, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 9, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
      { binding: 10, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } },
      // Resident proxy of the sun's distant shadow: a single binding, which carries both
      // the columns a ray traverses, that ray's settings and the two counters of the
      // counted frame. That is what lets the blend pass bind it too. Writable here, where the
      // counters are written; the water composite, which only traces, declares it read-only.
      { binding: SUN_FAR_PROXY_BINDING, visibility: GPUShaderStage.FRAGMENT, buffer: proxy },
    );
  // Probe grid and their coefficients: bound only by the bounce program, so a session
  // without bounce keeps exactly the previous layout.
  if (bounce)
    entries.push(
      { binding: 11, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 12, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
    );
  return entries;
}

export function createDeferredLayouts(device: GPUDevice, direct: boolean, bounce = false) {
  return {
    lighting: device.createBindGroupLayout({ entries: deferredLayoutEntries(direct, bounce) }),
    composition: device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'unfilterable-float' },
        },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    }),
  };
}

/**
 * Contract substitute resources: an empty tile list, an invalid shadow slice, a one-texel
 * atlas, and a probe grid at zero. A device that refuses the real atlas thus keeps valid
 * bindings, and the light simply stays without shadow instead of failing the frame; a frame
 * without bounce reads a grid whose probe count is zero, hence an indirect irradiance of
 * exactly zero. The blend pass borrows the same substitutes: one definition of what an
 * absent resource is worth.
 */
export function createDeferredPlaceholders(device: GPUDevice) {
  const tiles = device.createBuffer({
    label: 'WG empty light tiles',
    size: 256,
    usage: GPUBufferUsage.STORAGE,
  });
  const slices = device.createBuffer({
    label: 'WG empty shadow slices',
    size: SHADOW_SLICE_FLOATS * 4,
    usage: GPUBufferUsage.STORAGE,
  });
  const atlas = device.createTexture({
    label: 'WG empty shadow atlas',
    size: [1, 1, 1],
    format: 'depth32float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  // Shadow-atlas comparison is the engine's: reversed depth, hence `greater`.
  const sampler = device.createSampler({
    label: 'WG shadow comparison',
    compare: DEPTH_COMPARE,
    magFilter: 'linear',
    minFilter: 'linear',
  });
  // The substitute carries the size of `BounceGrid`, read where the struct is written: a binding
  // smaller than what the shader declares is refused by validation, and the device is lost.
  // At zero, the probe count is too and `sampleBounce` returns without reading a coefficient;
  // the probe buffer holds a whole probe, so its size also follows the struct.
  const bounceGrid = device.createBuffer({
    label: 'WG empty bounce grid',
    size: BOUNCE_GRID_BYTES,
    usage: GPUBufferUsage.UNIFORM,
  });
  const probes = device.createBuffer({
    label: 'WG empty bounce probes',
    size: PROBE_FLOATS * 4,
    usage: GPUBufferUsage.STORAGE,
  });
  // The absent proxy: a header of zeros, which the shader reads as a tree with no node and as
  // an absent distant shadow. Both lighting passes bind the same one, so a session without
  // proxy renders exactly the same image on opaque and on blend.
  const proxy = device.createBuffer({
    label: 'WG empty resident proxy',
    size: PLACEHOLDER_PROXY_BYTES,
    usage: GPUBufferUsage.STORAGE,
  });
  return {
    tiles,
    slices,
    atlasView: atlas.createView(),
    sampler,
    bounceGrid,
    probes,
    proxy,
    dispose() {
      tiles.destroy();
      slices.destroy();
      atlas.destroy();
      bounceGrid.destroy();
      probes.destroy();
      proxy.destroy();
    },
  };
}
