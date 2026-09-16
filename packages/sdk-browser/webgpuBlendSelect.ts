import { BLEND_SELECT_SHADER } from './webgpuBlendSelectShader.ts';
import { shaderFailed } from './gpuShaderModule.ts';
import { openValidation, validationError } from './gpuErrorScope.ts';
import { cleanupFailedHiz } from './gpuHizPipelines.ts';
import { bounceGroup, bounceLayout } from './bounceBindings.ts';

export type BlendSelect = NonNullable<Awaited<ReturnType<typeof createBlendSelect>>>;

const UNI_WORDS = 28;

/**
 * Le tronc des items transparents et les arguments indirects de leurs appels, sur la carte.
 *
 * Trois tampons statiques — les boites monde, la description de chaque appel, les arguments — et un
 * noyau d'un fil par item. Rien n'est alloue par image : l'uniforme des plans est reecrit, le noyau
 * est lance, et la passe de mélange n'a plus qu'a enchainer ses `drawIndirect`.
 */
export async function createBlendSelect(
  device: GPUDevice,
  itemCount: number,
  counts: GPUBuffer | undefined,
  args: GPUBuffer,
) {
  if (typeof device.createComputePipeline !== 'function' || itemCount < 1) return undefined;
  const made: GPUBuffer[] = [];
  const make = (label: string, size: number, usage: number) => {
    const buffer = device.createBuffer({ label, size: Math.max(16, size), usage });
    made.push(buffer);
    return buffer;
  };
  const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
  const bail = () => {
    for (const buffer of made) buffer.destroy();
    return undefined;
  };
  try {
    const uniforms = make(
      'WG blend frustum uniforms',
      UNI_WORDS * 4,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    );
    const boxes = make('WG blend world boxes', itemCount * 32, storage);
    const draws = make('WG blend draw descriptions', itemCount * 16, storage);
    const stats = make('WG blend frustum stats', 16, storage | GPUBufferUsage.COPY_SRC);
    const readback = device.createBuffer({
      label: 'WG blend frustum readback',
      size: 16,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    made.push(readback);
    openValidation(device);
    const module = device.createShaderModule({ code: BLEND_SELECT_SHADER });
    if (await shaderFailed(device, module)) return bail();
    const layout = bounceLayout(device, [
      'uniform',
      'read-only-storage',
      'read-only-storage',
      'read-only-storage',
      'storage',
      'storage',
    ]);
    const pipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module, entryPoint: 'selectBlendItems' },
    });
    // Sans primitive paginee il n'y a aucun compte a lire : le noyau ne touche jamais cette
    // liaison, et `draws` la remplit — jamais `args`, qu'il ecrit, et qu'un meme groupe ne peut
    // pas porter deux fois avec deux droits.
    const bindGroup = bounceGroup(device, layout, [
      uniforms,
      boxes,
      draws,
      counts ?? draws,
      args,
      stats,
    ]);
    if (await validationError(device)) return bail();
    const uni = new Float32Array(UNI_WORDS);
    const uniInts = new Uint32Array(uni.buffer);
    const groups = Math.ceil(itemCount / 64);
    let pending = false,
      copied = false,
      rejected = 0;
    return {
      /** Les boites monde des items, reecrites seulement quand la scene change de matrices. */
      uploadBoxes(packed: Float32Array) {
        device.queue.writeBuffer(
          boxes,
          0,
          packed.buffer as ArrayBuffer,
          packed.byteOffset,
          itemCount * 32,
        );
      },
      /** La description statique de chaque appel : primitive paginee, sommets, premier sommet. */
      uploadDraws(packed: Uint32Array) {
        device.queue.writeBuffer(
          draws,
          0,
          packed.buffer as ArrayBuffer,
          packed.byteOffset,
          itemCount * 16,
        );
      },
      /** Le compte d'items que le tronc a rejetes, tel que la derniere relecture l'a rendu. */
      frustumRejected: () => rejected,
      encode(encoder: GPUCommandEncoder, planes: Float64Array) {
        for (let p = 0; p < 24; p++) uni[p] = planes[p];
        uniInts[24] = itemCount;
        device.queue.writeBuffer(uniforms, 0, uni.buffer as ArrayBuffer, 0, UNI_WORDS * 4);
        encoder.clearBuffer(stats);
        const pass = encoder.beginComputePass({ label: 'WG blend frustum' });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(groups);
        pass.end();
        if (!pending && !copied) {
          encoder.copyBufferToBuffer(stats, 0, readback, 0, 4);
          copied = true;
        }
      },
      /** Relit le compteur quand la copie precedente est retombee : jamais dans l'image mesuree. */
      readStats() {
        if (pending || !copied) return;
        pending = true;
        copied = false;
        readback
          .mapAsync(GPUMapMode.READ)
          .then(() => {
            rejected = new Uint32Array(readback.getMappedRange())[0];
            readback.unmap();
            pending = false;
          })
          .catch(() => {
            pending = false;
          });
      },
      dispose() {
        for (const buffer of made) buffer.destroy();
      },
    };
  } catch {
    await cleanupFailedHiz(device, made);
    return undefined;
  }
}
