/**
 * Oracle du point H3-1 : `writeRows` de `webgpuAtlasJobs.ts` tel qu'il était avant le lot, recopié
 * ligne à ligne, l'appareil de banc qui enregistre ce que `writeTexture` couvre réellement, et les
 * pixels et bandes qui l'alimentent. Le banc et les tests le lisent tous.
 */
import type { TextureJob } from '../../webgpuAtlasJobs.ts';

/** Avant le lot : chaque bande de lignes était recopiée hors des pixels entiers par `slice()`. */
export function referenceWriteRows(
  device: GPUDevice,
  texture: GPUTexture,
  level: number,
  layer: number,
  pixels: Uint8Array,
  width: number,
): TextureJob['uploadRows'] {
  const bytesPerRow = width * 4;
  return (row, count) =>
    device.queue.writeTexture(
      { texture, mipLevel: level, origin: [0, row, layer] },
      pixels.slice(row * bytesPerRow, (row + count) * bytesPerRow),
      { bytesPerRow, rowsPerImage: count },
      { width, height: count },
    );
}

/** Ce qu'un transfert couvre vraiment : sa destination, son gabarit et ses octets de texels. */
type WriteRecord = {
  niveau: number;
  origine: number[];
  parLigne: number;
  lignesParImage: number;
  largeur: number;
  hauteur: number;
  octets: Uint8Array;
};

/**
 * L'appareil de banc. Il refait la validation que la spécification impose à `writeTexture` — assez
 * d'octets à partir de `offset`, pas de ligne plus courte que la région — puis ne garde de chaque
 * appel que ce que le GPU en verrait. `offset` n'a pas à être multiple de 4 hors format de
 * profondeur ou de gabarit, mais les deux atlas valent `width * 4` par ligne : on l'épingle.
 */
export function recordingDevice() {
  const calls: WriteRecord[] = [];
  const queue = {
    writeTexture(
      dest: { mipLevel?: number; origin: number[] },
      data: Uint8Array,
      layout: { offset?: number; bytesPerRow: number; rowsPerImage: number },
      size: { width: number; height: number },
    ) {
      const depart = layout.offset ?? 0;
      const requis = layout.bytesPerRow * (size.height - 1) + size.width * 4;
      if (depart % 4 !== 0) throw new Error('H3_OFFSET_NON_ALIGNE');
      if (layout.bytesPerRow < size.width * 4) throw new Error('H3_LIGNE_TROP_COURTE');
      if (depart + requis > data.byteLength) throw new Error('H3_DONNEES_TROP_COURTES');
      calls.push({
        niveau: dest.mipLevel ?? 0,
        origine: [...dest.origin],
        parLigne: layout.bytesPerRow,
        lignesParImage: layout.rowsPerImage,
        largeur: size.width,
        hauteur: size.height,
        octets: data.subarray(depart, depart + requis),
      });
    },
  };
  return { device: { queue } as unknown as GPUDevice, calls };
}

/** Des pixels qui ne se répètent pas : un octet déplacé d'une ligne se verrait. */
export function pixels(width: number, height: number, alea: () => number) {
  const octets = new Uint8Array(width * height * 4);
  for (let i = 0; i < octets.length; i++) octets[i] = (i * 31 + Math.floor(alea() * 7)) & 255;
  return octets;
}

/** Les bandes successives d'un niveau : elles couvrent exactement le rectangle, sans chevauchement. */
export function bandes(rows: number, bande: number) {
  const decoupe: Array<[number, number]> = [];
  for (let row = 0; row < rows; row += bande) decoupe.push([row, Math.min(bande, rows - row)]);
  return decoupe;
}
