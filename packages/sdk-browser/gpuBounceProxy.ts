import type { SceneProxy } from '../sdk-core/index.ts';

/** Un tampon résident écrit une fois, à la préparation : une image ne le touche jamais. */
function residentBuffer(device: GPUDevice, label: string, data: Float32Array | Uint32Array) {
  // Une liaison de stockage ne peut pas être vide : un proxy absent garde quatre octets de zéro,
  // et le nuanceur le voit comme un arbre sans nœud, donc comme un rayon qui ne touche rien.
  const size = Math.max(4, data.byteLength);
  const buffer = device.createBuffer({
    label,
    size,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  const target =
    data instanceof Float32Array
      ? new Float32Array(buffer.getMappedRange())
      : new Uint32Array(buffer.getMappedRange());
  target.set(data as never);
  buffer.unmap();
  return buffer;
}

export type GpuBounceProxy = ReturnType<typeof createGpuBounceProxy>;

/**
 * Le proxy résident en mémoire graphique : les triangles du monde, leur albédo, et les deux colonnes
 * de son BVH. Écrit une fois pour toutes, jamais rechargé, jamais dépendant de la caméra (LC1) —
 * c'est ce que les rayons des sondes touchent, et il ne change que si le cache change.
 *
 * Aucune lumière n'y est écrite : de la géométrie et un albédo, rien d'autre.
 */
export function createGpuBounceProxy(device: GPUDevice, proxy: SceneProxy) {
  const data = proxy.data;
  const empty = new Float32Array(0);
  const triangles = residentBuffer(
    device,
    'WG bounce proxy triangles v1',
    data?.triangles ?? empty,
  );
  const albedo = residentBuffer(
    device,
    'WG bounce proxy albedo v1',
    data?.albedo ?? new Uint32Array(0),
  );
  const nodeBounds = residentBuffer(
    device,
    'WG bounce proxy node bounds v1',
    data?.nodeBounds ?? empty,
  );
  const nodeChildren = residentBuffer(
    device,
    'WG bounce proxy node children v2',
    data?.nodeChildren ?? new Uint32Array(0),
  );
  const bytes =
    (data?.triangles.byteLength ?? 0) +
    (data?.albedo.byteLength ?? 0) +
    (data?.nodeBounds.byteLength ?? 0) +
    (data?.nodeChildren.byteLength ?? 0);
  return {
    triangles,
    albedo,
    nodeBounds,
    nodeChildren,
    /** Ce que le proxy occupe réellement en mémoire graphique, publié dans le diagnostic. */
    bytes,
    triangleCount: proxy.triangles,
    nodeCount: proxy.nodes,
    bounds: proxy.bounds,
    errorMetres: proxy.errorMetres,
    cellMetres: proxy.cellMetres,
    dispose() {
      triangles.destroy();
      albedo.destroy();
      nodeBounds.destroy();
      nodeChildren.destroy();
    },
  };
}
