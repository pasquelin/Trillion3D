import { LIGHT_SETTINGS } from '../sdk-core/index.ts';
import type { GpuBounceProxy } from './gpuBounceProxy.ts';
import {
  SUN_FAR_COUNTS,
  SUN_FAR_COUNTING_OFFSET,
  SUN_FAR_COUNT_OFFSET,
  SUN_FAR_PARAM_FLOATS,
  SUN_FAR_STATE_BYTES,
} from './sunFarShadowWgsl.ts';

/** Images entre deux relevés des compteurs. Les quatorze autres n'incrémentent rien du tout. */
const COUNT_EVERY_IMAGES = 15;
/** `GPUMapMode.READ`, ou sa valeur là où un appareil de test laisse l'énumération vide. */
const mapRead = () => (globalThis as { GPUMapMode?: { READ: number } }).GPUMapMode?.READ ?? 1;

/** Ce que la dernière image relevée a compté, et le numéro de cette image. */
export interface SunFarCounts {
  frame: number;
  tested: number;
  blocked: number;
}

export type GpuSunFarShadow = ReturnType<typeof createGpuSunFarShadow>;

/**
 * Les réglages et les compteurs de l'ombre lointaine du soleil, dans un seul bloc que la résolution
 * différée lit. Les colonnes du proxy, elles, ne sont jamais recopiées : le bloc dit seulement
 * qu'il y en a un, de combien relever l'origine d'un rayon, et jusqu'où le pousser.
 *
 * Le comptage est un diagnostic, donc il reste hors de la passe mesurée : le drapeau `params.z` ne
 * passe à un que sur une image sur quinze, et il est remis à zéro dès la suivante. Le relevé
 * lui-même est une copie de huit octets et une promesse, jamais une attente dans l'image.
 */
export function createGpuSunFarShadow(device: GPUDevice) {
  const state = device.createBuffer({
    label: 'WG sun far shadow state v1',
    size: SUN_FAR_STATE_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  const readback = device.createBuffer({
    label: 'WG sun far shadow counts readback',
    size: SUN_FAR_COUNTS * 4,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const params = new Float32Array(SUN_FAR_PARAM_FLOATS);
  const countingFlag = new Uint32Array(1);
  const counted: SunFarCounts = { frame: -1, tested: 0, blocked: 0 };
  let proxy: GpuBounceProxy | undefined,
    owned = false,
    countedReady = false,
    counting = false,
    copyEncoded = false,
    mapping = false,
    disposed = false,
    lastCountedFrame = -COUNT_EVERY_IMAGES;

  const writeParams = () => device.queue.writeBuffer(state, 0, params);
  const setCounting = (value: boolean) => {
    if (counting === value) return;
    counting = value;
    countingFlag[0] = value ? 1 : 0;
    device.queue.writeBuffer(state, SUN_FAR_COUNTING_OFFSET, countingFlag);
  };
  const onMapped = () => {
    if (disposed) return;
    const values = new Uint32Array(readback.getMappedRange(0, SUN_FAR_COUNTS * 4));
    counted.tested = values[0];
    counted.blocked = values[1];
    countedReady = true;
  };
  const onSettled = () => {
    try {
      readback.unmap();
    } catch {
      /* Déjà démappé par une libération. */
    }
    mapping = false;
  };

  return {
    state,
    /** Les quatre colonnes du proxy à lier, ou rien tant qu'aucun proxy n'est résident. */
    buffers(): readonly GPUBuffer[] | undefined {
      return proxy && [proxy.triangles, proxy.albedo, proxy.nodeBounds, proxy.nodeChildren];
    },
    get proxy() {
      return proxy;
    },
    /** Le décalage de l'origine d'un rayon, en mètres : publié dans le diagnostic tel qu'employé. */
    get offsetMetres() {
      return params[0];
    },
    /** Le départ du rayon le long de sa direction, en mètres : une maille du proxy chargé. */
    get startMetres() {
      return params[1];
    },
    get maxDistanceMetres() {
      return params[2];
    },
    /**
     * Adopte un proxy résident. `owns` dit si ce module l'a chargé pour lui : celui de la lumière
     * qui rebondit est emprunté, jamais recopié ni libéré ici. Le départ du rayon suit la maille
     * réellement obtenue par le cache, pas une constante : un proxy plus grossier part plus loin.
     */
    adopt(resident: GpuBounceProxy, owns: boolean) {
      proxy = resident;
      owned = owns;
      const [x0, y0, z0, x1, y1, z1] = resident.bounds;
      params[0] = LIGHT_SETTINGS.sunFarShadowOffsetMetres;
      params[1] = resident.cellMetres * LIGHT_SETTINGS.sunFarShadowStartCells;
      // La portée d'un rayon d'ombre : la diagonale de l'emprise du proxy. Au-delà, il n'y a plus
      // rien à couper, et un soleil est assez loin pour que tout occulteur tienne dedans.
      params[2] = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
      params[3] = resident.nodeCount > 0 ? 1 : 0;
      writeParams();
    },
    /**
     * Ce que l'image doit encoder avant sa passe d'éclairage : le relevé de l'image précédente,
     * puis, une image sur quinze, la remise à zéro des compteurs et l'allumage du drapeau.
     */
    prepare(encoder: GPUCommandEncoder, frame: number) {
      if (copyEncoded) {
        encoder.copyBufferToBuffer(state, SUN_FAR_COUNT_OFFSET, readback, 0, SUN_FAR_COUNTS * 4);
        copyEncoded = false;
        mapping = true;
      }
      const sample =
        !!proxy && !mapping && params[3] > 0 && frame - lastCountedFrame >= COUNT_EVERY_IMAGES;
      setCounting(sample);
      if (!sample) return;
      encoder.clearBuffer(state, SUN_FAR_COUNT_OFFSET, SUN_FAR_COUNTS * 4);
      copyEncoded = true;
      counted.frame = frame;
      lastCountedFrame = frame;
    },
    /** Demande le mappage du relevé, une fois l'image qui l'a copié soumise. */
    submitted() {
      if (!mapping || disposed) return;
      Promise.resolve(readback.mapAsync(mapRead(), 0, SUN_FAR_COUNTS * 4))
        .then(onMapped, () => {})
        .finally(onSettled);
    },
    /** Les compteurs de la dernière image relevée, ou rien tant qu'aucune n'est revenue. */
    counts(): SunFarCounts | undefined {
      return countedReady ? counted : undefined;
    },
    dispose() {
      disposed = true;
      countedReady = false;
      copyEncoded = false;
      state.destroy();
      readback.destroy();
      if (owned) proxy?.dispose();
      proxy = undefined;
    },
  };
}
