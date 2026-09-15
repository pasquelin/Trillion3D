import type * as THREE from 'three';
import type { textureRgba } from './visibilityBuffer.ts';

/**
 * Le transfert d'une texture source vers sa couche d'atlas, découpable en bandes de lignes.
 *
 * La ligne est l'unité indivisible : `uploadRows(row, count)` copie les lignes `[row, row+count)`
 * du rectangle source W×H aux mêmes lignes de la couche. Les tranches successives d'une texture
 * couvrent donc exactement le rectangle, sans chevauchement ni trou, et leur résultat est celui
 * d'un transfert en un bloc. Seule la dernière tranche rend la couche montrable : c'est après elle
 * que les mips sont régénérés et que le bit « prêt » passe à un.
 */
export type TextureJob = {
  kind: 'color' | 'data';
  layer: number;
  /** Octets du rectangle entier, soit `rows * bytesPerRow`. */
  bytes: number;
  rows: number;
  bytesPerRow: number;
  /** Première ligne encore à transférer ; elle vaut `rows` quand la dernière tranche est passée. */
  nextRow: number;
  /** Tranches refusées par l'appareil pour cette texture ; au-delà de la borne, elle est abandonnée. */
  failures: number;
  uploadRows: (row: number, count: number) => void;
};

function textureJob(
  kind: TextureJob['kind'],
  layer: number,
  rows: number,
  bytesPerRow: number,
  uploadRows: TextureJob['uploadRows'],
): TextureJob {
  return {
    kind,
    layer,
    bytes: rows * bytesPerRow,
    rows,
    bytesPerRow,
    nextRow: 0,
    failures: 0,
    uploadRows,
  };
}

/**
 * Le travail de transfert d'une texture source et l'échelle uv de sa couche dans l'atlas. Les
 * pixels déjà décodés partent par `writeTexture`, une image opaque au moteur par
 * `copyExternalImageToTexture` ; les deux découpent en bandes de lignes de la même façon.
 */
export function textureJobFor(options: {
  device: GPUDevice;
  texture: GPUTexture;
  rgba: ReturnType<typeof textureRgba>;
  map: THREE.Texture;
  layer: number;
  kind: TextureJob['kind'];
  atlas: [number, number];
  errorCode: string;
}): { job: TextureJob; scale: [number, number] } {
  const { device, texture, rgba, layer, kind, atlas } = options;
  if (rgba) {
    const bytesPerRow = rgba.width * 4;
    return {
      scale: [rgba.width / atlas[0], rgba.height / atlas[1]],
      job: textureJob(kind, layer, rgba.height, bytesPerRow, (row, count) => {
        device.queue.writeTexture(
          { texture, origin: [0, row, layer] },
          rgba.data.slice(row * bytesPerRow, (row + count) * bytesPerRow),
          { bytesPerRow, rowsPerImage: count },
          { width: rgba.width, height: count },
        );
      }),
    };
  }
  const image = options.map.image as GPUCopyExternalImageSource | undefined;
  if (!image || typeof device.queue.copyExternalImageToTexture !== 'function')
    throw new Error(options.errorCode);
  const width = 'width' in image ? (image as ImageBitmap).width : atlas[0];
  const height = 'height' in image ? (image as ImageBitmap).height : atlas[1];
  return {
    scale: [width / atlas[0], height / atlas[1]],
    job: textureJob(kind, layer, height, width * 4, (row, count) => {
      device.queue.copyExternalImageToTexture(
        { source: image, origin: [0, row] },
        { texture, origin: [0, row, layer] },
        [width, count],
      );
    }),
  };
}
