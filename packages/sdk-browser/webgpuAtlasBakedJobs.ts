import { previewLevelSize, type TexturePreview } from '../sdk-core/index.ts';
import type { TextureLevelReader } from './textureLevelReader.ts';
import { textureJob, type Placement, type TextureJob } from './webgpuAtlasJobs.ts';
import type { SlotPyramid } from './webgpuAtlasSlots.ts';

/**
 * Les travaux des niveaux cuits d'une texture — ceux au-dessus de la queue du sidecar, du plus
 * grossier au niveau 0 —, chacun lu dans le cache quand la file le juge utile, puis copié dans le
 * niveau de mip de même rang de sa couche, par bandes de lignes comme tout autre niveau.
 *
 * L'ordre du plus grossier au plus fin n'est pas une préférence : la résidence d'une couche ne
 * descend qu'au bas d'une suite sans trou depuis le 1×1, et un niveau 0 arrivé avant le 3 ne
 * serait pas montrable. Un travail est créé pour chaque niveau, mais rien n'est lu tant que la
 * pompe ne le demande pas : la file les classe par ce que l'écran regarde, et `fetch` ne part que
 * pour les premiers d'entre eux.
 *
 * L'image est copiée par `copyExternalImageToTexture`, le chemin même que la pleine résolution
 * prenait — mêmes octets, même conversion, même `premultipliedAlpha` à faux —, si bien qu'un niveau
 * cuit écrit dans l'atlas exactement ce que la carte y aurait écrit en le régénérant.
 */
export function bakedLevelJobs(options: {
  device: GPUDevice;
  texture: GPUTexture;
  place: Placement;
  preview: TexturePreview;
  kind: TextureJob['kind'];
  pyramid: SlotPyramid;
  read: TextureLevelReader;
}): TextureJob[] {
  const { device, texture, place, preview, kind, pyramid, read } = options;
  const jobs: TextureJob[] = [];
  for (let level = preview.bakedLevels - 1; level >= 0; level--) {
    const [width, height] = previewLevelSize(preview.width, preview.height, level);
    let bitmap: ImageBitmap | undefined;
    const upload = (row: number, count: number) => {
      if (!bitmap) throw new Error('TEXTURE_LEVEL_NOT_READ');
      device.queue.copyExternalImageToTexture(
        { source: bitmap, origin: [0, row] },
        { texture, mipLevel: level, origin: [0, row, place.layer] },
        [width, count],
      );
      // Une fois la dernière bande copiée, l'image décodée n'a plus de raison de vivre.
      if (row + count >= height) {
        bitmap.close();
        bitmap = undefined;
      }
    };
    // Un seul objet, celui que la file tient : `fetch` écrit `ready` sur lui, pas sur une copie.
    const job: TextureJob = {
      ...textureJob(kind, place, level, 0, height, width * 4, upload),
      pyramid,
      ready: false,
    };
    job.fetch = async () => {
      const image = await read(preview.sha256, preview.atlas, level);
      if (image.width !== width || image.height !== height) {
        image.close();
        throw new Error(
          `TEXTURE_LEVEL_SIZE: level ${level} is ${image.width}×${image.height}, expected ${width}×${height}`,
        );
      }
      bitmap = image;
      job.ready = true;
    };
    jobs.push(job);
  }
  return jobs;
}
