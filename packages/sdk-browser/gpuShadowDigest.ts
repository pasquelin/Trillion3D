import type { GpuShadowAtlas } from './gpuShadowAtlas.ts';

/** Ce qu'une lecture de l'atlas d'ombres publie : sa taille, ce qui y est écrit, son empreinte. */
export interface ShadowAtlasDigest {
  size: number;
  texels: number;
  /** Texels dont la profondeur n'est pas le zéro d'origine : ce que les cartes occupent réellement. */
  written: number;
  /** Empreinte FNV-1a 32 bits des profondeurs brutes, bit pour bit. */
  hash: number;
}

const OFFSET = 0x811c9dc5,
  PRIME = 0x01000193;

/**
 * Lit l'atlas d'ombres de profondeur et en rend l'empreinte, bit pour bit.
 *
 * C'est l'outil de preuve du dessin par pages : deux exécutions de la même scène, l'une redessinant
 * les faces entières et l'autre seulement les pages invalidées, doivent rendre **la même empreinte**.
 * La lecture n'a de sens qu'une fois la file d'attente vide — une page encore en attente porte
 * évidemment l'ancienne profondeur.
 *
 * Ce n'est pas une passe de l'image : elle alloue son tampon, lit, et le rend. Rien de tout cela ne
 * se produit tant que l'hôte ne le demande pas.
 */
export async function readShadowAtlasDigest(
  device: GPUDevice,
  atlas: GpuShadowAtlas,
): Promise<ShadowAtlasDigest> {
  const { size } = atlas;
  const bytesPerRow = size * 4;
  const buffer = device.createBuffer({
    label: 'WG shadow atlas digest',
    size: bytesPerRow * size,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  try {
    const encoder = device.createCommandEncoder({ label: 'WG shadow atlas digest' });
    encoder.copyTextureToBuffer(
      { texture: atlas.texture, aspect: 'depth-only' },
      { buffer, bytesPerRow, rowsPerImage: size },
      [size, size, 1],
    );
    device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const words = new Uint32Array(buffer.getMappedRange());
    let hash = OFFSET,
      written = 0;
    for (let index = 0; index < words.length; index++) {
      const word = words[index];
      if (word !== 0) written++;
      for (let byte = 0; byte < 32; byte += 8) {
        hash = Math.imul(hash ^ ((word >>> byte) & 0xff), PRIME);
      }
    }
    buffer.unmap();
    return { size, texels: words.length, written, hash: hash >>> 0 };
  } finally {
    buffer.destroy();
  }
}
