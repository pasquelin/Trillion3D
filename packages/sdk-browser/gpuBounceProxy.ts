import { PROXY_NODE_FLOATS, type SceneProxy } from '../sdk-core/index.ts';
import { PROXY_HEADER_WORDS, PROXY_LAYOUT_WORD } from './bounceNodeWgsl.ts';

/** Les mots d'un tableau, quel que soit son type : une colonne est une suite de mots, rien de plus. */
const words = (data: Float32Array | Uint32Array) =>
  new Uint32Array(data.buffer, data.byteOffset, data.length);

/** Le tampon résident de l'albédo : écrit une fois, à la préparation, jamais touché par une image. */
function albedoBuffer(device: GPUDevice, data: Uint32Array) {
  // Une liaison de stockage ne peut pas être vide : un proxy absent garde quatre octets de zéro,
  // et le nuanceur le voit comme un arbre sans nœud, donc comme un rayon qui ne touche rien.
  const buffer = device.createBuffer({
    label: 'WG bounce proxy albedo v2',
    size: Math.max(4, data.byteLength),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  new Uint32Array(buffer.getMappedRange()).set(data);
  buffer.unmap();
  return buffer;
}

export type GpuBounceProxy = ReturnType<typeof createGpuBounceProxy>;

/**
 * Le proxy résident en mémoire graphique : les triangles du monde, les deux colonnes de son BVH et
 * l'entête qui dit où chacune commence, dans **un seul tampon** ; l'albédo dans un second. Écrit
 * une fois pour toutes, jamais rechargé, jamais dépendant de la caméra (LC1) — c'est ce que les
 * rayons des sondes touchent, et il ne change que si le cache change.
 *
 * Une seule liaison pour la traversée, c'est ce qui permet aux **deux** passes qui éclairent de
 * tirer le rayon d'ombre lointaine : l'étage de fragments de la passe de mélange n'avait qu'un
 * tampon de stockage libre sur les huit que la norme garantit.
 *
 * Aucune lumière n'y est écrite : de la géométrie et un albédo, rien d'autre. Les quatre réglages
 * du rayon d'ombre et ses deux compteurs vivent dans l'entête, écrits par `gpuSunFarShadow`.
 */
export function createGpuBounceProxy(device: GPUDevice, proxy: SceneProxy) {
  const data = proxy.data;
  const columns = [
    words(data?.triangles ?? new Float32Array(0)),
    words(data?.nodeBounds ?? new Float32Array(0)),
    words(data?.nodeChildren ?? new Uint32Array(0)),
  ];
  // Le rang de départ de chaque colonne, compté depuis le premier mot qui suit l'entête : c'est ce
  // que le nuanceur ajoute à un index de triangle ou de nœud.
  const starts = [0, columns[0].length, columns[0].length + columns[1].length];
  const total = starts[2] + columns[2].length;
  const buffer = device.createBuffer({
    label: 'WG resident proxy v2',
    size: (PROXY_HEADER_WORDS + Math.max(4, total)) * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    mappedAtCreation: true,
  });
  const mapped = new Uint32Array(buffer.getMappedRange());
  // Le nombre de nœuds se lit dans la colonne des bornes, comme le faisait `arrayLength` avant que
  // les trois colonnes tiennent dans un tampon : la même valeur, à la même source.
  mapped[PROXY_LAYOUT_WORD] = columns[1].length / PROXY_NODE_FLOATS;
  for (let index = 0; index < 3; index++) {
    mapped[PROXY_LAYOUT_WORD + 1 + index] = starts[index];
    mapped.set(columns[index], PROXY_HEADER_WORDS + starts[index]);
  }
  buffer.unmap();
  const albedo = albedoBuffer(device, data?.albedo ?? new Uint32Array(0));
  return {
    buffer,
    albedo,
    /** Ce que le proxy occupe réellement en mémoire graphique, publié dans le diagnostic. */
    bytes: total * 4 + (data?.albedo.byteLength ?? 0),
    triangleCount: proxy.triangles,
    nodeCount: proxy.nodes,
    bounds: proxy.bounds,
    errorMetres: proxy.errorMetres,
    cellMetres: proxy.cellMetres,
    dispose() {
      buffer.destroy();
      albedo.destroy();
    },
  };
}
