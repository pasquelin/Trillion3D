import { frustumExcludesBox } from '../sdk-core/index.ts';
import type { createWebgpuBlendState } from './webgpuBlendState.ts';
type BlendState = ReturnType<typeof createWebgpuBlendState>;

/**
 * Les arguments indirects de la passe transparente : quatre mots par item, au rang de l'item.
 *
 * Le tampon appartient a la scene et non a l'image. La carte l'ecrit (`webgpuBlendSelect.ts`) ;
 * l'appareil qui n'a pas d'etage de calcul le fait ecrire par le processeur ci-dessous, avec les
 * comptes que sa propre coupe a donnes.
 */
export function createBlendArgsBuffer(device: GPUDevice, itemCount: number) {
  return device.createBuffer({
    label: 'WG blend indirect arguments',
    size: Math.max(16, itemCount * 16),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
  });
}

/**
 * Le repli processeur du tronc, pour un appareil sans etage de calcul : la meme regle que la
 * reference double precision, puisque c'est elle qu'il appelle. Rend le nombre d'items rejetes.
 */
export function writeBlendArgsCpu(blendState: BlendState, device: GPUDevice) {
  const { blendGpu, drawsPacked, argsBuffer, cpuItemCounts } = blendState;
  if (!argsBuffer) return 0;
  if (blendState.argsPacked.length < blendGpu.length * 4)
    blendState.argsPacked = new Uint32Array(Math.max(4, blendGpu.length * 4));
  const args = blendState.argsPacked;
  let rejected = 0;
  for (let i = 0; i < blendGpu.length; i++) {
    const item = blendGpu[i],
      box = item.bounds;
    const out =
      !!box &&
      frustumExcludesBox(blendState.blendPlanes, box[0], box[1], box[2], box[3], box[4], box[5]);
    if (out) rejected++;
    args[i * 4] = drawsPacked[i * 4 + 1];
    args[i * 4 + 1] = out
      ? 0
      : item.paged && item.pagedIndex !== undefined
        ? (cpuItemCounts[item.pagedIndex] ?? 0)
        : 1;
    args[i * 4 + 2] = drawsPacked[i * 4 + 2];
    args[i * 4 + 3] = 0;
  }
  device.queue.writeBuffer(argsBuffer, 0, args.buffer as ArrayBuffer, 0, blendGpu.length * 16);
  return rejected;
}
