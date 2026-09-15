import { SHADOW_CULL_FLOATS } from '../sdk-core/index.ts';
import { DRAW_INDIRECT_STRIDE, PAGE_BIND_ALIGN } from './gpuDraw.ts';
import { MAX_SHADOW_REGIONS } from './gpuShadowAtlas.ts';
import { SHADOW_CULL_SHADER } from './gpuShadowCullShader.ts';
import { createCheckedShaderModule } from './gpuShaderModule.ts';

/** Mots d'un uniforme de slot de dessin : la matrice, le cadre, puis le slot et son indirection. */
const DRAW_UNIFORM_WORDS = PAGE_BIND_ALIGN / 4;
const WORD_DRAW_SLOT = 20,
  WORD_INDIRECT = 21;

/**
 * L'unique table des liaisons du rejet : son ordre nomme à la fois la disposition et le groupe —
 * sphères, liste source, indirect source, gardés, indirect produit, uniforme, volumes, vivants.
 */
const BINDING_TYPES: readonly GPUBufferBindingType[] = [
  'read-only-storage',
  'read-only-storage',
  'read-only-storage',
  'storage',
  'storage',
  'uniform',
  'read-only-storage',
  'storage',
];

export type GpuShadowCull = Awaited<ReturnType<typeof createGpuShadowCull>>;

/**
 * Le rejet par région : une liste d'instances par région redessinée, et la commande indirecte qui va
 * avec. Tous les tampons sont alloués une fois pour le budget d'une image — au plus
 * `MAX_SHADOW_REGIONS` régions, au plus `capacity` clusters chacune — et une image n'alloue rien.
 */
export async function createGpuShadowCull(device: GPUDevice, capacity: number) {
  const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
  const kept = device.createBuffer({
    label: 'WG shadow kept clusters v1',
    size: Math.max(4, MAX_SHADOW_REGIONS * capacity * 4),
    usage: GPUBufferUsage.STORAGE,
  });
  const indirect = device.createBuffer({
    label: 'WG shadow indirect v1',
    size: MAX_SHADOW_REGIONS * DRAW_INDIRECT_STRIDE,
    usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.STORAGE,
  });
  const faceVolumes = device.createBuffer({
    label: 'WG shadow face volumes v1',
    size: MAX_SHADOW_REGIONS * SHADOW_CULL_FLOATS * 4,
    usage: storage,
  });
  const uniforms = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const live = device.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE });
  const offsets = device.createBuffer({ size: MAX_SHADOW_REGIONS * 4, usage: storage });
  const drawUniform = device.createBuffer({
    label: 'WG shadow draw slots v1',
    size: MAX_SHADOW_REGIONS * PAGE_BIND_ALIGN,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const all = [kept, indirect, faceVolumes, uniforms, live, offsets, drawUniform];
  const release = () => {
    for (const buffer of all) buffer.destroy();
  };
  try {
    // La place de chaque région dans la liste commune, et son slot de dessin : posées une fois.
    const offsetWords = new Uint32Array(MAX_SHADOW_REGIONS);
    const drawWords = new Uint32Array(MAX_SHADOW_REGIONS * DRAW_UNIFORM_WORDS);
    for (let region = 0; region < MAX_SHADOW_REGIONS; region++) {
      offsetWords[region] = region * capacity;
      drawWords[region * DRAW_UNIFORM_WORDS + WORD_DRAW_SLOT] = region;
      drawWords[region * DRAW_UNIFORM_WORDS + WORD_INDIRECT] = 1;
    }
    device.queue.writeBuffer(offsets, 0, offsetWords);
    device.queue.writeBuffer(drawUniform, 0, drawWords);
    const module = await createCheckedShaderModule(device, SHADOW_CULL_SHADER, 'SHADOW_CULL');
    const layout = device.createBindGroupLayout({
      entries: BINDING_TYPES.map((type, binding) => ({
        binding,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type },
      })),
    });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const prepare = device.createComputePipeline({
      layout: pipelineLayout,
      compute: { module, entryPoint: 'shadowCullPrepare' },
    });
    const scatter = device.createComputePipeline({
      layout: pipelineLayout,
      compute: { module, entryPoint: 'shadowCullScatter' },
    });
    const volumes = new Float32Array(MAX_SHADOW_REGIONS * SHADOW_CULL_FLOATS);
    const uniData = new Uint32Array(4);
    let bound: GPUBuffer[] = [],
      group: GPUBindGroup | undefined;
    return {
      capacity,
      kept,
      indirect,
      offsets,
      drawUniform,
      volumes,
      /** Pousse les volumes des `faces` premières faces : un seul écrit, jamais un par face. */
      flushVolumes(faces: number) {
        if (faces) device.queue.writeBuffer(faceVolumes, 0, volumes, 0, faces * SHADOW_CULL_FLOATS);
      },
      /**
       * Encode le rejet de toutes les faces de l'image. `slots` est le nombre de commandes de la
       * compaction principale, `rows` le majorant des instances qu'elle a pu produire, et
       * `maxVertexCount` le compte de sommets qu'une instance dessine.
       */
      encode(
        encoder: GPUCommandEncoder,
        sources: { spheres: GPUBuffer; source: GPUBuffer; sourceIndirect: GPUBuffer },
        faces: number,
        slots: number,
        rows: number,
        maxVertexCount: number,
      ) {
        if (!faces) return;
        // Les tampons du groupe, dans l'ordre des liaisons : ceux de l'image d'abord, les nôtres
        // ensuite. Le groupe n'est rebâti que si l'un d'eux a changé d'identité.
        const buffers = [
          sources.spheres,
          sources.source,
          sources.sourceIndirect,
          kept,
          indirect,
          uniforms,
          faceVolumes,
          live,
        ];
        if (!group || buffers.some((buffer, index) => bound[index] !== buffer)) {
          bound = buffers;
          group = device.createBindGroup({
            layout,
            entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } })),
          });
        }
        uniData[0] = faces;
        uniData[1] = slots;
        uniData[2] = maxVertexCount;
        uniData[3] = capacity;
        device.queue.writeBuffer(uniforms, 0, uniData);
        const pass = encoder.beginComputePass({ label: 'WG shadow cull' });
        pass.setBindGroup(0, group);
        pass.setPipeline(prepare);
        pass.dispatchWorkgroups(1);
        pass.setPipeline(scatter);
        pass.dispatchWorkgroups(Math.max(1, Math.ceil(Math.min(rows, capacity) / 64)), faces);
        pass.end();
      },
      dispose: release,
    };
  } catch (error) {
    release();
    throw error;
  }
}
