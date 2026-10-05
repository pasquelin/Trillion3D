import { SUBSURFACE_BINDING } from '../../scene/subsurface.ts';
import { LIGHTING_RECEIVER_BINDING } from './surfaceWgsl.ts';
import { receiverLayoutEntries, receiverPlaceholders } from '../../webgpu/visibility/receiver.ts';
import { arrayView } from '../../gpu/shadow/layers.ts';
import { PROBE_TEXELS, emptyAtlas } from '../../bounce/atlas.ts';
import { CONTRACT_SHADOW_BINDINGS } from '../direct/lightingWgsl.ts';
import { CONTRACT_VSM_BINDINGS } from '../direct/shadowWgsl.ts';
import { BOUNCE_GRID_BYTES } from '../../bounce/uniform.ts';
import { PROXY_HEADER_BYTES } from '../../bounce/sizes.ts';
import { RESIDENT_PROXY_BINDING } from '../../bounce/nodeWgsl.ts';
import { BOUNCE_SURFACE_BINDING } from '../../bounce/reflectWgsl.ts';
import { VSM_PROJECTION_RECORD_BYTES } from '../../vsm/constants.ts';
import { VSM_UNIFORMS_BYTES } from '../../vsm/uniforms.ts';
import {
  VSM_TRANSMISSION_FORMAT,
  VSM_TRANSMISSION_RESOLVE_BINDING,
} from '../../vsm/transmissionWgsl.ts';
import {
  VSM_MASK_TABLE_BINDING,
  VSM_MASK_TILES_BINDING,
  createVsmMaskTable,
} from '../../vsm/projectionMaskTable.ts';
import {
  VSM_PROJECTION_MASK_FORMAT,
  VSM_PROJECTION_TILE_FORMAT,
} from '../../vsm/projectionWgsl.ts';

/** Empty proxy header: no proxy ray without resident nodes. */
const PLACEHOLDER_PROXY_BYTES = PROXY_HEADER_BYTES + 16;
/**
 * Bindings of the deferred pass. The unlit view stops at the surfaces and the uniform; the contract
 * program adds the declared lights, their per-tile lists and the virtual shadow maps they read; the
 * bounce one adds the probe grid. None of the three reads a light written in the scene: there is
 * none left. The water composite extends the full list with its own bindings, so a surface lit
 * there is read on the same numbers; without `resolve`, it takes the pool in place of the opaque
 * resolve's own entries.
 */
export function deferredLayoutEntries(direct: boolean, bounce = false, resolve = true) {
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
      // The virtual shadow maps a non-mask read samples: page table, projection data, uniforms,
      // and the pool's dynamic slice at the translucent depth's number.
      {
        binding: CONTRACT_VSM_BINDINGS.pageTable,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: 'read-only-storage' },
      },
      {
        binding: CONTRACT_VSM_BINDINGS.projectionData,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: 'read-only-storage' },
      },
      {
        binding: CONTRACT_VSM_BINDINGS.uniforms,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      },
      // The resident proxy the mirror reflection traces: a single read-only binding, which
      // carries the columns a ray traverses and that ray's settings, so every lighting pass
      // (opaque, blend, water) binds it alike.
      {
        binding: RESIDENT_PROXY_BINDING,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: 'read-only-storage' },
      },
      // The opaque resolve's compact shadow mask (`vsmMaskFactor`); the water composite's
      // translucent casters' transmission on the same number: both words.
      {
        binding: CONTRACT_SHADOW_BINDINGS.transmittance,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'uint', viewDimension: '2d-array' },
      },
    );
  // The pool a non-mask read samples: the water composite's alone, the resolve reading the mask
  // (`directShadowWgsl`), so it holds the eight storage buffers with the receiver's three.
  if (direct && !resolve)
    entries.push({
      binding: CONTRACT_VSM_BINDINGS.pool,
      visibility: GPUShaderStage.FRAGMENT,
      buffer: { type: 'read-only-storage' },
    });
  // The receiver offset's reads, subsurface, the mask's transmission, table and tiles: only the
  // opaque resolve.
  if (direct && resolve)
    entries.push(
      ...receiverLayoutEntries(LIGHTING_RECEIVER_BINDING, GPUShaderStage.FRAGMENT),
      {
        binding: SUBSURFACE_BINDING,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'unfilterable-float' },
      },
      // The translucent casters' transmission (the mask holds the transmittance's number).
      {
        binding: VSM_TRANSMISSION_RESOLVE_BINDING,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'uint', viewDimension: '2d-array' },
      },
      // The mask's decode table (`projectionMaskTable.ts`) and its tile words.
      {
        binding: VSM_MASK_TABLE_BINDING,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'unfilterable-float' },
      },
      {
        binding: VSM_MASK_TILES_BINDING,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'uint' },
      },
    );
  // Probe grid, their coefficients and the surface cache a reflection reads: bound only by the
  // bounce program, so a session without bounce keeps exactly the previous layout. The two last
  // are atlases (`atlas.ts`, #1410): no storage buffer of the eight.
  if (bounce)
    entries.push(
      { binding: 11, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      {
        binding: 12,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'unfilterable-float', viewDimension: '2d-array' },
      },
      {
        binding: BOUNCE_SURFACE_BINDING,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'unfilterable-float' },
      },
    );
  return entries;
}

/** The resolve's layout; each composition's is its own (`compositions.ts`). */
export const createDeferredLightingLayout = (device: GPUDevice, direct: boolean, bounce = false) =>
  device.createBindGroupLayout({ entries: deferredLayoutEntries(direct, bounce) });

/**
 * Contract substitute resources: an empty tile list, a one-texel transmittance layer, a probe
 * grid at zero, an empty surface cache, and the virtual shadow maps' stand-ins. A device without
 * the maps keeps valid bindings, the light simply unshadowed; a frame without bounce reads zero
 * probes, hence zero indirect light. The blend pass borrows the same substitutes.
 */
export type DeferredPlaceholders = ReturnType<typeof createDeferredPlaceholders>;
export function createDeferredPlaceholders(device: GPUDevice) {
  const tiles = device.createBuffer({
    label: 'Trillion3D empty light tiles',
    size: 256,
    usage: GPUBufferUsage.STORAGE,
  });
  // One texel: the shadow read tells it from a real layer by its size, and never reads it.
  const transmittance = device.createTexture({
    label: 'Trillion3D empty shadow transmittance',
    size: [1, 1, 1],
    format: VSM_TRANSMISSION_FORMAT,
    usage: GPUTextureUsage.TEXTURE_BINDING,
  });
  // The substitute carries the size of `BounceGrid`, read where the struct is written: a binding
  // smaller than what the shader declares is refused by validation, and the device is lost.
  // At zero, the probe count is too and `sampleBounce` returns without reading a coefficient;
  // the probe atlas holds a whole probe, so its size also follows the struct.
  const bounceGrid = device.createBuffer({
    label: 'Trillion3D empty bounce grid',
    size: BOUNCE_GRID_BYTES,
    usage: GPUBufferUsage.UNIFORM,
  });
  const probes = emptyAtlas(device, 'Trillion3D empty bounce probes', PROBE_TEXELS);
  // One texel of zero: the water composite binds it while bounce is off, and reads none.
  const surfaceCache = emptyAtlas(device, 'Trillion3D empty bounce surface cache');
  // The absent proxy: a header of zeros, which the shader reads as a tree with no node.
  // Both lighting passes bind the same one, so a session without
  // proxy renders exactly the same image on opaque and on blend.
  const proxy = device.createBuffer({
    label: 'Trillion3D empty resident proxy',
    size: PLACEHOLDER_PROXY_BYTES,
    usage: GPUBufferUsage.STORAGE,
  });
  const receiver = receiverPlaceholders(device);
  // The virtual shadow maps' stand-ins: no light reads them (no light has a map without them).
  const vsmPageTable = device.createBuffer({
    label: 'Trillion3D empty VSM page table',
    size: 16,
    usage: GPUBufferUsage.STORAGE,
  });
  const vsmProjectionData = device.createBuffer({
    label: 'Trillion3D empty VSM projection data',
    size: VSM_PROJECTION_RECORD_BYTES,
    usage: GPUBufferUsage.STORAGE,
  });
  const vsmUniforms = device.createBuffer({
    label: 'Trillion3D empty VSM uniforms',
    size: VSM_UNIFORMS_BYTES,
    usage: GPUBufferUsage.UNIFORM,
  });
  const vsmPool = device.createBuffer({
    label: 'Trillion3D empty VSM pool',
    size: 16,
    usage: GPUBufferUsage.STORAGE,
  });
  // The resolve's mask stand-in, one zero texel (every lane lit), its tile words, one zero texel
  // (no layer stored), and the mask's decode table.
  const vsmMask = device.createTexture({
    label: 'Trillion3D empty VSM mask',
    size: [1, 1, 1],
    format: VSM_PROJECTION_MASK_FORMAT,
    usage: GPUTextureUsage.TEXTURE_BINDING,
  });
  const vsmMaskTiles = device.createTexture({
    label: 'Trillion3D empty VSM mask tiles',
    size: [1, 1],
    format: VSM_PROJECTION_TILE_FORMAT,
    usage: GPUTextureUsage.TEXTURE_BINDING,
  });
  const vsmMaskTable = createVsmMaskTable(device);
  return {
    vsmPageTable,
    vsmProjectionData,
    vsmUniforms,
    vsmPool,
    vsmMask: arrayView(vsmMask),
    vsmMaskTiles: vsmMaskTiles.createView(),
    /** The mask's decode table (`projectionMaskTable.ts`): `fill` before the first frame that
     *  reads a mask is submitted. */
    vsmMaskTable,
    tiles,
    transmittanceView: arrayView(transmittance),
    bounceGrid,
    probes: probes.createView({ dimension: '2d-array' }),
    surfaceCache: surfaceCache.createView(),
    proxy,
    receiver: receiver.resources,
    /** The empty normal atlas: what a transparent item without normals reads (zeros). */
    emptyNormals: receiver.normals,
    dispose() {
      receiver.dispose();
      for (const buffer of [vsmPageTable, vsmProjectionData, vsmUniforms, vsmPool])
        buffer.destroy();
      tiles.destroy();
      transmittance.destroy();
      vsmMask.destroy();
      vsmMaskTiles.destroy();
      vsmMaskTable.texture.destroy();
      bounceGrid.destroy();
      probes.destroy();
      surfaceCache.destroy();
      proxy.destroy();
    },
  };
}
