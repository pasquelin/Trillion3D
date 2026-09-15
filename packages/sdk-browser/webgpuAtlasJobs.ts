import type * as THREE from 'three';
import type { TexturePreview } from '../sdk-core/index.ts';
import { previewLevelSize } from '../sdk-core/index.ts';
import type { textureRgba } from './visibilityBuffer.ts';
import type { SlotPyramid } from './webgpuAtlasSlots.ts';

/**
 * Le transfert d'un niveau de texture vers sa couche d'atlas, découpable en bandes de lignes.
 *
 * La ligne est l'unité indivisible : `uploadRows(row, count)` copie les lignes `[row, row+count)`
 * du rectangle source aux mêmes lignes du niveau `level` de la couche. Les tranches successives
 * d'un niveau couvrent donc exactement le rectangle, sans chevauchement ni trou, et leur résultat
 * est celui d'un transfert en un bloc. Un niveau progressif venu du sidecar (`stage` 0) rend la
 * couche montrable un cran plus net ; seule la pleine résolution (`stage` 1) la rend prête, et
 * c'est après elle que la chaîne de mips est régénérée sur GPU.
 */
export type TextureJob = {
  kind: 'color' | 'data';
  /** Slot global de la texture : ce que la table des pages nomme et ce que la table des slots indexe. */
  slot: number;
  /** Classe de taille et couche dans cette classe. */
  classIndex: number;
  layer: number;
  /** Niveau de mip écrit ; 0 est la pleine résolution. */
  level: number;
  /** 0 pour un niveau progressif du sidecar, 1 pour la pleine résolution. */
  stage: number;
  /** Les niveaux que sa texture attend ; seul un niveau progressif en porte, et la résidence de la
   *  couche s'y lit sans table parallèle tenue à côté de la file. */
  pyramid?: SlotPyramid;
  /** Octets du rectangle entier, soit `rows * bytesPerRow`. */
  bytes: number;
  rows: number;
  bytesPerRow: number;
  /** Première ligne encore à transférer ; elle vaut `rows` quand la dernière tranche est passée. */
  nextRow: number;
  /** Tranches refusées par l'appareil pour ce niveau ; au-delà de la borne, il est abandonné. */
  failures: number;
  uploadRows: (row: number, count: number) => void;
};

type Placement = { slot: number; classIndex: number; layer: number };

function textureJob(
  kind: TextureJob['kind'],
  place: Placement,
  level: number,
  stage: number,
  rows: number,
  bytesPerRow: number,
  uploadRows: TextureJob['uploadRows'],
): TextureJob {
  return {
    kind,
    ...place,
    level,
    stage,
    bytes: rows * bytesPerRow,
    rows,
    bytesPerRow,
    nextRow: 0,
    failures: 0,
    uploadRows,
  };
}

/**
 * Le geste unique de transfert de pixels déjà décodés vers une bande de lignes de la couche : un
 * niveau progressif du sidecar et la pleine résolution ne s'y distinguent que par `level`.
 *
 * La bande n'est pas recopiée avant d'être remise à l'appareil : `dataLayout.offset` désigne son
 * premier octet dans les pixels entiers, que `writeTexture` accepte plus grands que la région
 * écrite — la spécification n'exige l'offset multiple de 4 que pour un format de profondeur ou de
 * gabarit, et les deux atlas sont `rgba8unorm`. L'offset vaut de toute façon `row * width * 4`.
 */
function writeRows(
  device: GPUDevice,
  texture: GPUTexture,
  level: number,
  layer: number,
  pixels: Uint8Array,
  width: number,
): TextureJob['uploadRows'] {
  const bytesPerRow = width * 4;
  // `AllowSharedBufferSource` admet une vue sur un tampon partagé ; le type de `@webgpu/types`
  // n'admet, lui, que les vues sur un `ArrayBuffer` — d'où ce resserrement, que la tranche faisait
  // silencieusement puisque `slice()` rend toujours une vue sur un tampon non partagé.
  const source = pixels as Uint8Array<ArrayBuffer>;
  return (row, count) =>
    device.queue.writeTexture(
      { texture, mipLevel: level, origin: [0, row, layer] },
      source,
      { offset: row * bytesPerRow, bytesPerRow, rowsPerImage: count },
      { width, height: count },
    );
}

/**
 * Les travaux des niveaux progressifs d'une texture, du plus grossier au plus fin : chacun s'écrit
 * dans le niveau de mip de même rang que celui qu'il porte dans la chaîne de la source, si bien que
 * l'échantillonneur le retrouve à l'échelle uv de la couche sans rien recalculer. Les rendre dans
 * cet ordre fait avancer la résidence d'un cran à chaque niveau reçu.
 */
export function previewLevelJobs(options: {
  device: GPUDevice;
  texture: GPUTexture;
  place: Placement;
  preview: TexturePreview;
}): TextureJob[] {
  const { device, texture, place, preview } = options;
  const pyramid: SlotPyramid = {
    first: preview.firstLevel,
    last: preview.firstLevel + preview.levels.length - 1,
  };
  const jobs: TextureJob[] = [];
  for (let index = preview.levels.length - 1; index >= 0; index--) {
    const level = preview.firstLevel + index;
    const [width, height] = previewLevelSize(preview.width, preview.height, level);
    const upload = writeRows(device, texture, level, place.layer, preview.levels[index], width);
    jobs.push({ ...textureJob('color', place, level, 0, height, width * 4, upload), pyramid });
  }
  return jobs;
}

/**
 * Le travail de transfert de la pleine résolution d'une texture et l'échelle uv de sa couche dans
 * sa classe. Les pixels déjà décodés partent par `writeTexture`, une image opaque au moteur par
 * `copyExternalImageToTexture` ; les deux découpent en bandes de lignes de la même façon.
 */
export function textureJobFor(options: {
  device: GPUDevice;
  texture: GPUTexture;
  rgba: ReturnType<typeof textureRgba>;
  map: THREE.Texture;
  place: Placement;
  kind: TextureJob['kind'];
  atlas: [number, number];
  errorCode: string;
}): { job: TextureJob; scale: [number, number] } {
  const { device, texture, rgba, place, kind, atlas } = options;
  if (rgba) {
    const upload = writeRows(device, texture, 0, place.layer, rgba.data, rgba.width);
    return {
      scale: [rgba.width / atlas[0], rgba.height / atlas[1]],
      job: textureJob(kind, place, 0, 1, rgba.height, rgba.width * 4, upload),
    };
  }
  const image = options.map.image as GPUCopyExternalImageSource | undefined;
  if (!image || typeof device.queue.copyExternalImageToTexture !== 'function')
    throw new Error(options.errorCode);
  const width = 'width' in image ? (image as ImageBitmap).width : atlas[0];
  const height = 'height' in image ? (image as ImageBitmap).height : atlas[1];
  return {
    scale: [width / atlas[0], height / atlas[1]],
    job: textureJob(kind, place, 0, 1, height, width * 4, (row, count) => {
      device.queue.copyExternalImageToTexture(
        { source: image, origin: [0, row] },
        { texture, origin: [0, row, place.layer] },
        [width, count],
      );
    }),
  };
}
