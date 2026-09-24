/**
 * Allocation ledger of a WebGPU device: every texture and buffer created, their bytes computed
 * from the descriptor, returned on destroy. WebGPU does not publish occupied memory; this ledger
 * is the only sum that depends on no subsystem, and a buffer never destroyed stays counted
 * here — that is intended, a leak is read here before it is read elsewhere.
 *
 * It is installed once per device, on the instance, before the engine's first allocation; a
 * second call returns the same ledger. A texture of a format unknown to the table counts zero
 * bytes and increments `unknownFormats`: a total that carries any is not a proof.
 */
const LABEL_NONE = 'unlabeled';

/** Bytes per texel of the uncompressed formats the engine may allocate. */
const BYTES_PER_TEXEL: Partial<Record<GPUTextureFormat, number>> = {
  r8unorm: 1,
  r8uint: 1,
  stencil8: 1,
  r16float: 2,
  r16uint: 2,
  rg8unorm: 2,
  depth16unorm: 2,
  r32float: 4,
  r32uint: 4,
  rg16float: 4,
  rg16uint: 4,
  rgba8unorm: 4,
  'rgba8unorm-srgb': 4,
  bgra8unorm: 4,
  'bgra8unorm-srgb': 4,
  rgba8uint: 4,
  rgb10a2unorm: 4,
  rg11b10ufloat: 4,
  depth24plus: 4,
  'depth24plus-stencil8': 4,
  depth32float: 4,
  'depth32float-stencil8': 5,
  rg32float: 8,
  rg32uint: 8,
  rgba16float: 8,
  rgba16uint: 8,
  rgba32float: 16,
  rgba32uint: 16,
};
/** Bytes per 4×4 block of the compressed formats: what T5 will allocate. */
const BYTES_PER_BLOCK: Partial<Record<GPUTextureFormat, number>> = {
  'bc1-rgba-unorm': 8,
  'bc1-rgba-unorm-srgb': 8,
  'bc4-r-unorm': 8,
  'bc3-rgba-unorm': 16,
  'bc3-rgba-unorm-srgb': 16,
  'bc5-rg-unorm': 16,
  'bc7-rgba-unorm': 16,
  'bc7-rgba-unorm-srgb': 16,
  'astc-4x4-unorm': 16,
  'astc-4x4-unorm-srgb': 16,
};

function extent(size: GPUExtent3D): [number, number, number] {
  if (Array.isArray(size)) return [size[0] ?? 1, size[1] ?? 1, size[2] ?? 1];
  const s = size as GPUExtent3DDict;
  return [s.width, s.height ?? 1, s.depthOrArrayLayers ?? 1];
}

/** Bytes of a texture, every mip level included; `null` on a format outside the table. */
export function textureBytesOf(descriptor: GPUTextureDescriptor): number | null {
  const perTexel = BYTES_PER_TEXEL[descriptor.format];
  const perBlock = BYTES_PER_BLOCK[descriptor.format];
  if (perTexel === undefined && perBlock === undefined) return null;
  const [width, height, depth] = extent(descriptor.size);
  const levels = descriptor.mipLevelCount ?? 1;
  const volume = descriptor.dimension === '3d';
  let bytes = 0;
  for (let level = 0; level < levels; level++) {
    const w = Math.max(1, width >> level),
      h = Math.max(1, height >> level),
      d = volume ? Math.max(1, depth >> level) : depth;
    bytes +=
      perTexel !== undefined
        ? w * h * d * perTexel
        : Math.ceil(w / 4) * Math.ceil(h / 4) * d * perBlock!;
  }
  return bytes * (descriptor.sampleCount ?? 1);
}

interface GpuDeviceLedgerSnapshot {
  /** Live bytes, every allocation included. */
  bytes: number;
  /** The same bytes by label, heaviest first. */
  byLabel: Record<string, number>;
  /** Textures of a format outside the table, counted as zero bytes. */
  unknownFormats: number;
  /** Live allocations. */
  live: number;
}
export interface GpuDeviceLedger {
  snapshot(): GpuDeviceLedgerSnapshot;
}

/** Device subset the ledger observes: what a fake test device provides. */
export type LedgerDevice = Pick<GPUDevice, 'createTexture' | 'createBuffer'>;

const ledgers = new WeakMap<LedgerDevice, GpuDeviceLedger>();

/** Installs the ledger on the device — a session's handle, above its tags: it counts by the labels
 *  the engine wrote — or returns the one already there. */
export function installGpuDeviceLedger(device: LedgerDevice): GpuDeviceLedger {
  const existing = ledgers.get(device);
  if (existing) return existing;
  const live = new Map<object, { label: string; bytes: number }>();
  let unknownFormats = 0;
  // The snapshot is read every host frame, held frame included: it is rebuilt only after an
  // allocation or a destroy, never in a still scene.
  let held: GpuDeviceLedgerSnapshot | undefined;
  const track = <T extends { destroy(): void }>(resource: T, label: string, bytes: number) => {
    live.set(resource, { label, bytes });
    held = undefined;
    const destroy = resource.destroy;
    resource.destroy = function (this: T) {
      if (live.delete(resource)) held = undefined;
      return destroy.call(this);
    };
    return resource;
  };
  const createTexture = device.createTexture.bind(device);
  const createBuffer = device.createBuffer.bind(device);
  device.createTexture = (descriptor) => {
    const bytes = textureBytesOf(descriptor);
    if (bytes === null) unknownFormats++;
    return track(createTexture(descriptor), descriptor.label ?? LABEL_NONE, bytes ?? 0);
  };
  device.createBuffer = (descriptor) =>
    track(createBuffer(descriptor), descriptor.label ?? LABEL_NONE, descriptor.size);
  const ledger: GpuDeviceLedger = {
    snapshot() {
      if (held) return held;
      const sums = new Map<string, number>();
      let bytes = 0;
      for (const entry of live.values()) {
        bytes += entry.bytes;
        sums.set(entry.label, (sums.get(entry.label) ?? 0) + entry.bytes);
      }
      const byLabel = Object.fromEntries([...sums].sort((a, b) => b[1] - a[1]));
      return (held = { bytes, byLabel, unknownFormats, live: live.size });
    },
  };
  ledgers.set(device, ledger);
  return ledger;
}

/** A device's ledger, or `undefined` until one is installed on it. */
export const gpuDeviceLedgerOf = (device: LedgerDevice | undefined) =>
  device ? ledgers.get(device) : undefined;
