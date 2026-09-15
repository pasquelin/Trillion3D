import { LIGHT_SETTINGS } from '../sdk-core/index.ts';
import type { GpuBounceProxy } from './gpuBounceProxy.ts';
import {
  SUN_FAR_COUNTS,
  SUN_FAR_COUNTING_OFFSET,
  SUN_FAR_COUNT_OFFSET,
  SUN_FAR_PARAM_FLOATS,
  SUN_FAR_PROXY_COLUMNS,
  SUN_FAR_STATE_BYTES,
} from './sunFarShadowWgsl.ts';

/** Images entre deux relevés des compteurs. Les quatorze autres n'incrémentent rien du tout. */
const COUNT_EVERY_IMAGES = 15;
/** Les deux compteurs relevés, en octets : la taille de la copie comme celle du mappage. */
const COUNT_BYTES = SUN_FAR_COUNTS * 4;
/** Les rangs des quatre réglages dans le bloc, dans l'ordre où le nuanceur les lit. */
const OFFSET = 0,
  START = 1,
  MAX_DISTANCE = 2,
  PRESENT = 3;
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
 * Le comptage est un diagnostic, donc il reste hors de la passe mesurée : le drapeau de relevé ne
 * passe à un que sur une image sur quinze, et il retombe à zéro dès la suivante, si bien que les
 * quatorze autres n'exécutent aucun `atomicAdd`. Le relevé lui-même est une copie de huit octets et
 * une promesse, jamais une attente dans l'image.
 */
export function createGpuSunFarShadow(device: GPUDevice) {
  const state = device.createBuffer({
    label: 'WG sun far shadow state v1',
    size: SUN_FAR_STATE_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  const readback = device.createBuffer({
    label: 'WG sun far shadow counts readback',
    size: COUNT_BYTES,
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
    const values = new Uint32Array(readback.getMappedRange(0, COUNT_BYTES));
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
    /** Les colonnes du proxy à lier, ou rien tant qu'aucun proxy n'est résident. */
    buffers(): readonly GPUBuffer[] | undefined {
      const resident = proxy;
      return resident && SUN_FAR_PROXY_COLUMNS.map((column) => resident[column]);
    },
    get proxy() {
      return proxy;
    },
    /** Le décalage de l'origine d'un rayon, en mètres : publié dans le diagnostic tel qu'employé. */
    get offsetMetres() {
      return params[OFFSET];
    },
    /** Le départ du rayon le long de sa direction, en mètres : une maille du proxy chargé. */
    get startMetres() {
      return params[START];
    },
    get maxDistanceMetres() {
      return params[MAX_DISTANCE];
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
      params[OFFSET] = LIGHT_SETTINGS.sunFarShadowOffsetMetres;
      params[START] = resident.cellMetres * LIGHT_SETTINGS.sunFarShadowStartCells;
      // La portée d'un rayon d'ombre : la diagonale de l'emprise du proxy. Au-delà, il n'y a plus
      // rien à couper, et un soleil est assez loin pour que tout occulteur tienne dedans.
      params[MAX_DISTANCE] = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
      params[PRESENT] = resident.nodeCount > 0 ? 1 : 0;
      writeParams();
    },
    /**
     * Ce que l'image doit encoder avant sa passe d'éclairage : le relevé de l'image précédente,
     * puis, une image sur quinze, la remise à zéro des compteurs et l'allumage du drapeau.
     */
    prepare(encoder: GPUCommandEncoder, frame: number) {
      if (copyEncoded) {
        encoder.copyBufferToBuffer(state, SUN_FAR_COUNT_OFFSET, readback, 0, COUNT_BYTES);
        copyEncoded = false;
        mapping = true;
      }
      // Un proxy sans nœud laisse ce drapeau à zéro : il n'y a alors ni rayon tiré ni rien à compter.
      const sample =
        params[PRESENT] > 0 && !mapping && frame - lastCountedFrame >= COUNT_EVERY_IMAGES;
      setCounting(sample);
      if (!sample) return;
      encoder.clearBuffer(state, SUN_FAR_COUNT_OFFSET, COUNT_BYTES);
      copyEncoded = true;
      counted.frame = frame;
      lastCountedFrame = frame;
    },
    /** Demande le mappage du relevé, une fois l'image qui l'a copié soumise. */
    submitted() {
      if (!mapping || disposed) return;
      Promise.resolve(readback.mapAsync(mapRead(), 0, COUNT_BYTES))
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
