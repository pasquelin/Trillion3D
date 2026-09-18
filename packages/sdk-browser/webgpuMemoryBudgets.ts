import { POOL_LAYER_BYTES } from './textureTiles.ts';
import { pageBufferCap } from './gpuPageResize.ts';

/**
 * Les budgets de mémoire du moteur, comme chez la référence : des réservoirs de taille FIXE, réglés
 * par l'hôte et jamais lus sur la machine — la mémoire libre change à chaque instant, un budget lu
 * au démarrage serait faux cinq minutes après. Ce qu'une vue demande de plus que le réservoir
 * s'affiche plus grossier ; rien ne refuse, rien ne s'arrête. Une valeur qui ne peut pas être
 * tenue telle quelle est ramenée à ce qui peut l'être, et la raison est publiée (`clamp`).
 */
export const DEFAULT_GEOMETRY_POOL_BUDGET = 512 * 1024 * 1024;
/** 512 Mio, à parts égales entre l'atlas couleur et l'atlas de données, en couches de 63,5 Mio. */
export const DEFAULT_TEXTURE_POOL_BUDGET = 512 * 1024 * 1024;

/** Pourquoi un réservoir ne fait pas la taille demandée, ou `null` quand il la fait. */
type PoolClamp =
  'root-cover' | 'scene' | 'page-cap' | 'device-limit' | 'minimum' | 'ceiling' | null;

export type GeometryPool = {
  /** Octets demandés par l'hôte, et fentes de page que le réservoir en tire. */
  budgetBytes: number;
  slots: number;
  pageBytes: number;
  allocatedBytes: number;
  clamp: PoolClamp;
};

const checkBudget = (bytes: number, name: string) => {
  if (!Number.isSafeInteger(bytes) || bytes < 1) throw new Error(name);
};

/**
 * Les fentes du pool de pages de géométrie pour un budget en octets — `r.Nanite.Streaming.
 * StreamingPoolSize` chez la référence, 512 Mo par défaut. La couverture racine y tient toujours,
 * comme ses pages racines résidentes hors pool : un budget plus petit qu'elle est relevé jusqu'à
 * elle, nommément. Une scène plus petite que le budget ne prend que ce qu'elle a, et un plafond en
 * pages (`maxResidentPages`, celui des bancs et des tests) borne aussi, comme le plafond de la
 * session (`ceilingSlots`, ce que les tables par page dessinable ont taillé). Seule la limite de
 * l'APPAREIL peut refuser, quand même la couverture racine n'y entre pas.
 */
export function geometryPoolFor(options: {
  budgetBytes: number;
  pageBytes: number;
  uniquePages: number;
  rootPages: number;
  maxResidentPages?: number;
  ceilingSlots?: number;
  limits?: Parameters<typeof pageBufferCap>[0];
}): GeometryPool {
  const { budgetBytes, pageBytes, uniquePages, maxResidentPages, ceilingSlots, limits } = options;
  checkBudget(budgetBytes, 'INVALID_GEOMETRY_POOL_BUDGET');
  const floor = Math.max(1, options.rootPages);
  let slots = Math.floor(budgetBytes / pageBytes),
    clamp: PoolClamp = null;
  if (maxResidentPages !== undefined && maxResidentPages < slots) {
    slots = maxResidentPages;
    clamp = 'page-cap';
  }
  if (uniquePages < slots) {
    slots = uniquePages;
    clamp = 'scene';
  }
  if (ceilingSlots !== undefined && ceilingSlots < slots) {
    slots = ceilingSlots;
    clamp = 'ceiling';
  }
  if (slots < floor) {
    slots = floor;
    clamp = 'root-cover';
  }
  const deviceBytes = pageBufferCap(limits);
  const deviceSlots = Math.floor(deviceBytes / pageBytes);
  if (deviceSlots < slots) {
    if (deviceSlots < floor)
      throw new Error(
        `GEOMETRY_POOL_DEVICE_LIMIT: ${floor} root pages of ${pageBytes} bytes, device allows ${deviceBytes}`,
      );
    slots = deviceSlots;
    clamp = 'device-limit';
  }
  return { budgetBytes, slots, pageBytes, allocatedBytes: slots * pageBytes, clamp };
}

export type TexturePool = {
  budgetBytes: number;
  /** Couches par atlas, et octets des deux atlas. */
  layers: number;
  allocatedBytes: number;
  clamp: PoolClamp;
};

/**
 * Les couches par atlas que le budget du pool de textures donne. Sous une couche par atlas — le
 * minimum pour que chaque texture montre sa queue —, le réservoir est relevé à une couche, nommément
 * ; au-dessus de ce que l'appareil accepte de couches, il est ramené à cette limite, nommément.
 */
export function texturePoolFor(
  budgetBytes: number,
  device: { limits?: { maxTextureArrayLayers?: number } } | undefined,
): TexturePool {
  checkBudget(budgetBytes, 'INVALID_TEXTURE_POOL_BUDGET');
  let layers = Math.floor(budgetBytes / 2 / POOL_LAYER_BYTES),
    clamp: PoolClamp = null;
  if (layers < 1) {
    layers = 1;
    clamp = 'minimum';
  }
  const limit = device?.limits?.maxTextureArrayLayers;
  if (typeof limit === 'number' && layers > limit) {
    layers = Math.max(1, limit);
    clamp = 'device-limit';
  }
  return { budgetBytes, layers, allocatedBytes: 2 * layers * POOL_LAYER_BYTES, clamp };
}
