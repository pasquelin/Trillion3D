import { BLEND_EXPAND_SHADER } from './webgpuBlendExpandWgsl.ts';
import { shaderFailed } from './gpuShaderModule.ts';
import { openValidation, validationError } from './gpuErrorScope.ts';
import { cleanupFailedHiz } from './gpuHizPipelines.ts';
import {
  blendExpandUniform,
  EXPAND_GROUP,
  EXPAND_PASSES,
  RUN_WORDS,
  UNI_WORDS,
} from './webgpuBlendRuns.ts';

export type BlendExpand = NonNullable<Awaited<ReturnType<typeof createBlendExpand>>>;

/** Chaque passe a sa région d'uniforme, à son propre alignement de liaison dynamique. */
const UNI_STRIDE = 256;
/** Les huit tampons de stockage du noyau, dans l'ordre des rangs que le nuanceur déclare. */
export const STORAGE_TYPES: GPUBufferBindingType[] = [
  'read-only-storage',
  'read-only-storage',
  'read-only-storage',
  'read-only-storage',
  'read-only-storage',
  'storage',
  'storage',
  'storage',
];

/**
 * Les quatre lancements du noyau : un groupe de fils par paquet d'entrées, UN seul pour la somme
 * courante sur les paquets, un fil par entrée, un fil par tranche. Écrits une fois pour l'encodage
 * de production et pour la preuve « carte = modèle » qui rejoue le noyau.
 */
/** Les quatre points d'entrée du noyau, dans l'ordre où ils s'enchaînent. */
export const BLEND_EXPAND_ENTRIES = [
  'countBlendGroups',
  'scanBlendGroups',
  'placeBlendEntries',
  'writeBlendRuns',
];

export const blendExpandDispatch = (entries: number, runs: number) => {
  const groups = Math.ceil(Math.max(1, entries) / EXPAND_GROUP);
  return [groups, 1, groups, Math.ceil(Math.max(1, runs) / EXPAND_GROUP)];
};

/**
 * Le noyau qui étale le plan trié, et les tampons de scène qu'il lit.
 *
 * Rien n'est alloué par image. Ce que l'image donne tient en trois écritures : le verdict du tronc
 * (un bit par item), l'ordre de peinture quand il a bougé, et les douze mots d'uniforme de chaque
 * passe. Ce que l'image obtient est la liste d'instances que le nuanceur de mélange lit et un
 * argument indirect par tranche — jamais par item.
 */
export async function createBlendExpand(
  device: GPUDevice,
  sizes: { items: number; planWords: number; scratchWords: number },
  shared: { counts: GPUBuffer | undefined; clusters: GPUBuffer | undefined },
  outputs: { expanded: GPUBuffer; args: GPUBuffer },
) {
  if (typeof device.createComputePipeline !== 'function' || sizes.items < 1) return undefined;
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
      'WG blend expand uniforms',
      UNI_STRIDE * EXPAND_PASSES,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    );
    const plan = make('WG blend sorted plan', sizes.planWords * 4, storage);
    const keep = make('WG blend frustum verdicts', ((sizes.items + 31) >> 5) * 4, storage);
    const draws = make('WG blend draw descriptions', sizes.items * 16, storage);
    const scratch = make('WG blend expand scratch', sizes.scratchWords * 4, GPUBufferUsage.STORAGE);
    openValidation(device);
    const module = device.createShaderModule({ code: BLEND_EXPAND_SHADER });
    if (await shaderFailed(device, module)) return bail();
    const layout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: UNI_WORDS * 4 },
        },
        ...STORAGE_TYPES.map((type, index) => ({
          binding: index + 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type },
        })),
      ],
    });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const pipelines = BLEND_EXPAND_ENTRIES.map((entryPoint) =>
      device.createComputePipeline({ layout: pipelineLayout, compute: { module, entryPoint } }),
    );
    // Sans primitive paginée il n'y a ni compte ni liste de grappes à lire : le noyau ne touche
    // jamais ces deux liaisons, et `draws` les remplit — un même groupe ne peut pas rester vide.
    const bindGroup = device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: uniforms, size: UNI_WORDS * 4 } },
        ...[
          plan,
          keep,
          draws,
          shared.counts ?? draws,
          shared.clusters ?? draws,
          scratch,
          outputs.expanded,
          outputs.args,
        ].map((buffer, index) => ({ binding: index + 1, resource: { buffer } })),
      ],
    });
    if (await validationError(device)) return bail();
    const uni = new Uint32Array(UNI_WORDS);
    const offsets = [0];
    return {
      /** La description statique de chaque item : rang paginé, morceaux, base de table, sommets. */
      uploadDraws(packed: Uint32Array) {
        device.queue.writeBuffer(
          draws,
          0,
          packed.buffer as ArrayBuffer,
          packed.byteOffset,
          sizes.items * 16,
        );
      },
      /** Le verdict du tronc de l'image : un bit par item, quelques centaines d'octets. */
      uploadKeep(packed: Uint32Array) {
        device.queue.writeBuffer(keep, 0, packed.buffer as ArrayBuffer, packed.byteOffset);
      },
      /** L'ordre de peinture et ses tranches, écrits seulement quand le classement les a bougés —
       *  et seulement les tranches que l'image porte, qui sont quelques-unes, pas quelques mille. */
      uploadPlan(
        region: { order: number; runs: number },
        order: Uint32Array,
        runs: Uint32Array,
        runCount: number,
      ) {
        if (!order.length) return;
        device.queue.writeBuffer(
          plan,
          region.order * 4,
          order.buffer as ArrayBuffer,
          order.byteOffset,
          order.byteLength,
        );
        device.queue.writeBuffer(
          plan,
          region.runs * 4,
          runs.buffer as ArrayBuffer,
          runs.byteOffset,
          Math.max(1, runCount) * RUN_WORDS * 4,
        );
      },
      encode(
        encoder: GPUComputePassEncoder,
        pass: number,
        region: { order: number; runs: number; args: number },
        counts: { entries: number; runs: number; instanceBase: number },
        scene: { maxVertexWords: number; vertexShift: number },
      ) {
        blendExpandUniform(uni, counts, region, scene);
        device.queue.writeBuffer(uniforms, pass * UNI_STRIDE, uni);
        offsets[0] = pass * UNI_STRIDE;
        encoder.setBindGroup(0, bindGroup, offsets);
        const lancements = blendExpandDispatch(counts.entries, counts.runs);
        for (let step = 0; step < pipelines.length; step++) {
          encoder.setPipeline(pipelines[step]);
          encoder.dispatchWorkgroups(lancements[step]);
        }
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
