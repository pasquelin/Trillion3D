import { textureLevelUrl } from '../sdk-core/index.ts';
import { checked } from './clusterPages.ts';

/** Ce qu'un moteur lit d'un niveau cuit : l'image décodée par le navigateur, prête à copier. */
export type TextureLevelReader = (
  sha256: string,
  atlas: number,
  level: number,
) => Promise<ImageBitmap>;

/**
 * Le lecteur des niveaux cuits d'un cache, bâti par l'explorateur qui connaît l'adresse du
 * manifeste ; le moteur, lui, ne reçoit que la fonction. Le décodage est celui du navigateur, hors
 * du fil principal, avec exactement les options que le chargeur glTF de Three emploie pour l'image
 * source (`premultiplyAlpha: 'none'`, `colorSpaceConversion: 'none'`) : les octets qui atteignent
 * l'atlas par ce chemin sont ceux qui l'atteignaient par l'autre.
 */
export function createTextureLevelReader(
  textures: { url: string } | undefined,
  base: string,
  signal?: AbortSignal,
): TextureLevelReader | undefined {
  if (!textures || typeof createImageBitmap !== 'function') return undefined;
  return async (sha256, atlas, level) => {
    const url = new URL(textureLevelUrl(textures.url, sha256, atlas, level), base).href;
    const blob = await (await checked(url, signal)).blob();
    return createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  };
}
