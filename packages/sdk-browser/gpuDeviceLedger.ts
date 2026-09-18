/**
 * Le registre des allocations d'un appareil WebGPU : chaque texture et chaque tampon créés, leurs
 * octets calculés depuis le descripteur, rendus à la destruction. WebGPU ne publie pas la mémoire
 * occupée ; ce registre est la seule somme qui ne dépende d'aucun sous-système, et un tampon jamais
 * détruit y reste compté — c'est voulu, une fuite se lit ici avant de se lire ailleurs.
 *
 * Il se pose une fois par appareil, sur l'instance, avant la première allocation du moteur ; un
 * second appel rend le même registre. Une texture d'un format inconnu de la table compte zéro octet
 * et incrémente `unknownFormats` : un total qui en porte n'est pas une preuve.
 */
const LABEL_NONE = 'sans étiquette';

/** Octets par texel des formats non compressés que le moteur peut allouer. */
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
/** Octets par bloc de 4×4 des formats compressés : ce que T5 allouera. */
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

/** Les octets d'une texture, tous niveaux de mips compris ; `null` sur un format hors table. */
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
  /** Octets vivants, toutes allocations confondues. */
  bytes: number;
  /** Les mêmes octets par étiquette, la plus lourde d'abord. */
  byLabel: Record<string, number>;
  /** Textures d'un format hors table, comptées pour zéro octet. */
  unknownFormats: number;
  /** Allocations vivantes. */
  live: number;
}
export interface GpuDeviceLedger {
  snapshot(): GpuDeviceLedgerSnapshot;
}

/** Le sous-ensemble de l'appareil que le registre observe : ce qu'un faux appareil de test fournit. */
export type LedgerDevice = Pick<GPUDevice, 'createTexture' | 'createBuffer'>;

const ledgers = new WeakMap<LedgerDevice, GpuDeviceLedger>();

/** Pose le registre sur l'appareil, ou rend celui qui s'y trouve déjà. */
export function installGpuDeviceLedger(device: LedgerDevice): GpuDeviceLedger {
  const existing = ledgers.get(device);
  if (existing) return existing;
  const live = new Map<object, { label: string; bytes: number }>();
  let unknownFormats = 0;
  // Le relevé est lu à chaque image de l'hôte, image tenue comprise : il n'est rebâti qu'après une
  // allocation ou une destruction, jamais dans une scène immobile.
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

/** Le registre d'un appareil, ou `undefined` tant qu'aucun n'y est posé. */
export const gpuDeviceLedgerOf = (device: LedgerDevice | undefined) =>
  device ? ledgers.get(device) : undefined;
