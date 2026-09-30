import { BOUNCE_ATLAS_FORMAT } from './atlas.ts';

/**
 * Bindings of the bounce compute passes, described by their type alone.
 *
 * Both passes — surface cache and probes — read the same proxy columns at the same slots:
 * one way to describe a binding keeps the two shaders and the two groups from drifting
 * apart. An unused slot is not declared at all: a pass that no longer needs lights does
 * not bind them.
 */

/** An atlas (`atlas.ts`) read with `textureLoad`, or written as a storage texture (`-out`): flat,
 *  or one layer per cascade level (`-array`). */
type AtlasSlot = 'atlas' | 'atlas-array' | 'atlas-out' | 'atlas-array-out';
/** A slot's type: a buffer, an atlas, or `null` for a slot the pass does not use. */
export type BounceSlot = GPUBufferBindingType | AtlasSlot | null;

const ATLASES: Record<AtlasSlot, Omit<GPUBindGroupLayoutEntry, 'binding' | 'visibility'>> = {
  atlas: { texture: { sampleType: 'unfilterable-float' } },
  'atlas-array': { texture: { sampleType: 'unfilterable-float', viewDimension: '2d-array' } },
  'atlas-out': { storageTexture: { access: 'write-only', format: BOUNCE_ATLAS_FORMAT } },
  'atlas-array-out': {
    storageTexture: {
      access: 'write-only',
      format: BOUNCE_ATLAS_FORMAT,
      viewDimension: '2d-array',
    },
  },
};
const isAtlas = (type: BounceSlot): type is AtlasSlot => !!type && type in ATLASES;

/** Layout of a pass: one type per slot. */
export function bounceLayout(device: GPUDevice, types: BounceSlot[]) {
  return device.createBindGroupLayout({
    entries: types.flatMap((type, binding) =>
      type
        ? [
            {
              binding,
              visibility: GPUShaderStage.COMPUTE,
              ...(isAtlas(type) ? ATLASES[type] : { buffer: { type } }),
            },
          ]
        : [],
    ),
  });
}

/** Matching group: one resource per declared slot, in the same order — a buffer, or an atlas's
 *  view where `types` names an atlas. */
export function bounceGroup(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  resources: (GPUBuffer | GPUTextureView | null)[],
  types?: BounceSlot[],
) {
  return device.createBindGroup({
    layout,
    entries: resources.flatMap((resource, binding) =>
      resource
        ? [
            {
              binding,
              resource: isAtlas(types?.[binding] ?? null)
                ? (resource as GPUTextureView)
                : { buffer: resource as GPUBuffer },
            },
          ]
        : [],
    ),
  });
}
