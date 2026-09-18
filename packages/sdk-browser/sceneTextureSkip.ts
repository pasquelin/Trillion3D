import { previewIsWhole, type ClusterManifest } from '../sdk-core/index.ts';

/**
 * Un PNG blanc de 1×1, opaque : ce que le chargeur glTF reçoit à la place d'une image dont la
 * chaîne de mips est cuite dans le cache. L'objet `THREE.Texture` existe alors — c'est lui que la
 * table des associations nomme, et lui que l'atlas range —, mais son image ne pèse rien, et les
 * mégaoctets de la source ne traversent ni le réseau ni le décodeur du navigateur.
 */
export const PLACEHOLDER_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP4DwQACfsD/Wj6HMwAAAAASUVORK5CYII=';

/**
 * Les adresses des images que le chargeur peut se dispenser de lire : celles dont CHAQUE entrée
 * du sidecar porte une chaîne entière — tout ce qui dépasse la queue est cuit —, et qui en ont au
 * moins une. Une image sans entrée a échoué au décodage du compilateur, et une image dont une
 * entrée n'est pas entière a encore besoin de sa source : ces deux-là sont lues comme avant.
 *
 * `resolve` écrit l'adresse comme le chargeur de l'hôte l'écrira — pour Three, dossier de la scène
 * + `uri` telle quelle, sans normalisation —, parce que c'est cette chaîne-là que le modificateur
 * d'URL reçoit : un `./` ou un caractère encodé autrement par `new URL` ferait rater la
 * comparaison, et l'image serait lue malgré tout. La règle vient de l'hôte, pas d'ici.
 */
export function bakedImageUrls(
  metadata: ClusterManifest,
  images: ReadonlyArray<{ uri?: string }> | undefined,
  resolve: (uri: string) => string,
): Set<string> {
  const whole = new Map<number, boolean>();
  for (const preview of metadata.texturePreviews ?? []) {
    whole.set(preview.image, (whole.get(preview.image) ?? true) && previewIsWhole(preview));
  }
  const urls = new Set<string>();
  if (!metadata.textures || !images) return urls;
  for (const [image, complete] of whole) {
    const uri = images[image]?.uri;
    if (complete && uri && !uri.startsWith('data:')) urls.add(resolve(uri));
  }
  return urls;
}
