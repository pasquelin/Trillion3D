import { LIGHT_SETTINGS } from '../sdk-core/index.ts';
import {
  PROXY_COUNTING_OFFSET,
  PROXY_COUNTS,
  PROXY_COUNT_OFFSET,
  PROXY_PARAM_FLOATS,
} from './bounceNodeWgsl.ts';
import type { GpuBounceProxy } from './gpuBounceProxy.ts';
import { createGpuPeriodicReadback } from './gpuPeriodicReadback.ts';

/** Les deux compteurs relevés, en octets : la taille de la copie comme celle du mappage. */
const COUNT_BYTES = PROXY_COUNTS * 4;
/** Les rangs des quatre réglages dans l'entête, dans l'ordre où le nuanceur les lit. */
const OFFSET = 0,
  START = 1,
  MAX_DISTANCE = 2,
  PRESENT = 3;

/** Ce que la dernière image relevée a compté, et le numéro de cette image. */
export interface SunFarCounts {
  frame: number;
  tested: number;
  blocked: number;
}

export type GpuSunFarShadow = ReturnType<typeof createGpuSunFarShadow>;

/**
 * Les réglages et les compteurs de l'ombre lointaine du soleil, écrits dans l'**entête du proxy
 * résident** : le même tampon que les deux passes qui éclairent lient pour le traverser. Les
 * colonnes ne sont jamais recopiées ; l'entête dit seulement qu'il y a un proxy, de combien relever
 * l'origine d'un rayon, et jusqu'où le pousser.
 *
 * Sans proxy adopté, il n'y a rien à écrire : les passes lient le remplaçant de la résolution
 * différée, un entête de zéros où la présence vaut zéro, et la surface lointaine reste éclairée sans
 * ombre portée exactement comme avant que ce rayon existe.
 *
 * Le comptage est un diagnostic, donc il reste hors de la passe mesurée : le drapeau de relevé ne
 * passe à un que sur une image sur quinze, et il retombe à zéro dès la suivante, si bien que les
 * quatorze autres n'exécutent aucun `atomicAdd`. Le relevé lui-même est une copie de huit octets et
 * une promesse, jamais une attente dans l'image.
 */
export function createGpuSunFarShadow(device: GPUDevice) {
  const params = new Float32Array(PROXY_PARAM_FLOATS);
  const countingFlag = new Uint32Array(1);
  const counted: SunFarCounts = { frame: -1, tested: 0, blocked: 0 };
  const reader = createGpuPeriodicReadback((mapped) => {
    const values = new Uint32Array(mapped);
    counted.tested = values[0];
    counted.blocked = values[1];
  });
  reader.adopt(
    device.createBuffer({
      label: 'WG sun far shadow counts readback',
      size: COUNT_BYTES,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    }),
  );
  let proxy: GpuBounceProxy | undefined,
    owned = false,
    counting = false,
    copyOwed = false;

  const setCounting = (value: boolean) => {
    if (counting === value || !proxy) return;
    counting = value;
    countingFlag[0] = value ? 1 : 0;
    device.queue.writeBuffer(proxy.buffer, PROXY_COUNTING_OFFSET, countingFlag);
  };

  return {
    /**
     * Le tampon à lier, ou rien tant qu'aucun proxy n'est résident. C'est celui du proxy lui-même,
     * rendu tel quel : les deux passes comparent la ressource qu'on leur donne à celle qu'elles ont
     * liée, si bien qu'un tampon neuf à chaque image leur ferait refaire leur groupe pour rien.
     */
    buffer(): GPUBuffer | undefined {
      return proxy?.buffer;
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
      device.queue.writeBuffer(resident.buffer, 0, params);
      // L'entête neuf porte un drapeau de relevé à zéro : c'est aussi l'état que ce module tient.
      counting = false;
    },
    /**
     * Ce que l'image doit encoder avant sa passe d'éclairage : le relevé de l'image précédente,
     * puis, une image sur quinze, la remise à zéro des compteurs et l'allumage du drapeau.
     */
    prepare(encoder: GPUCommandEncoder, frame: number) {
      if (!proxy) return;
      if (copyOwed) {
        reader.copy(encoder, proxy.buffer, PROXY_COUNT_OFFSET, COUNT_BYTES);
        copyOwed = false;
      }
      // Un proxy sans nœud laisse ce drapeau à zéro : il n'y a alors ni rayon tiré ni rien à compter.
      const sample = params[PRESENT] > 0 && reader.due(frame);
      setCounting(sample);
      if (!sample) return;
      encoder.clearBuffer(proxy.buffer, PROXY_COUNT_OFFSET, COUNT_BYTES);
      copyOwed = true;
      counted.frame = frame;
      reader.sampled(frame);
    },
    /** Demande le mappage du relevé, une fois l'image qui l'a copié soumise. */
    submitted: reader.submitted,
    /** Les compteurs de la dernière image relevée, ou rien tant qu'aucune n'est revenue. */
    counts(): SunFarCounts | undefined {
      return reader.ready ? counted : undefined;
    },
    dispose() {
      reader.dispose();
      if (owned) proxy?.dispose();
      proxy = undefined;
    },
  };
}
