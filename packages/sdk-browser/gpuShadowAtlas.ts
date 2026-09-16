import {
  LIGHT_SETTINGS,
  MAX_SHADOW_SLICES,
  POINT_FACES,
  RECTS_PER_SLICE,
  SHADOW_FACE_FLOATS,
  SHADOW_SLICE_FLOATS,
} from '../sdk-core/index.ts';
import { SHADOW_DEPTH_SHADER } from './gpuShadowShader.ts';
import { createCheckedShaderModule } from './gpuShaderModule.ts';

/** Étiquette de la passe mesurée ; `gpuShadowsMs` est lu sous ce nom. */
export const SHADOW_PASS = 'WG shadow atlas v1';
/** Alignement d'un décalage dynamique d'uniforme : une région par entrée de 256 octets. */
const FACE_STRIDE = 256;
/** Octets réellement lus d'une entrée : la matrice, le rectangle d'atlas, l'enveloppe de la lampe. */
const FACE_BYTES = 96;
/**
 * Régions au plus dans une image : le plafond des tampons, pas un réglage de qualité. Une face
 * entièrement périmée tient dans une seule région, donc ce plafond vaut au moins ce que l'ancien
 * plafond de quatre lampes autorisait ; le budget en millisecondes s'arrête presque toujours avant.
 */
export const MAX_SHADOW_REGIONS = LIGHT_SETTINGS.shadowUpdatesPerFrame * POINT_FACES;
export const shadowAtlasBytes = () => LIGHT_SETTINGS.shadowAtlasSize ** 2 * 4;

export type GpuShadowAtlas = Awaited<ReturnType<typeof createGpuShadowAtlas>>;

/**
 * L'atlas d'ombres de profondeur : une texture 4096², une tranche par lampe à ombre, six faces pour
 * une ponctuelle et une pour un projecteur. Le tampon de tranches est ce que la résolution différée
 * relit ; le tampon de faces porte les matrices de l'image, une par décalage dynamique.
 */
export async function createGpuShadowAtlas(device: GPUDevice, pageLayout: GPUBindGroupLayout) {
  const size = LIGHT_SETTINGS.shadowAtlasSize;
  const texture = device.createTexture({
    label: 'WG shadow depth atlas v1',
    size: [size, size, 1],
    format: 'depth32float',
    // `COPY_SRC` n'est là que pour la preuve : l'hôte peut relire l'atlas et comparer son empreinte
    // entre un redessin par pages et un redessin complet. Aucune passe de l'image ne le copie.
    usage:
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_SRC,
  });
  const faceUniform = device.createBuffer({
    label: 'WG shadow faces v1',
    size: MAX_SHADOW_REGIONS * FACE_STRIDE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const sliceBuffer = device.createBuffer({
    label: 'WG shadow slices v1',
    size: MAX_SHADOW_SLICES * SHADOW_SLICE_FLOATS * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const slicePacked = new Float32Array(MAX_SHADOW_SLICES * SHADOW_SLICE_FLOATS);
  const facePacked = new Float32Array((MAX_SHADOW_REGIONS * FACE_STRIDE) / 4);
  const release = () => {
    texture.destroy();
    faceUniform.destroy();
    sliceBuffer.destroy();
  };
  try {
    const module = await createCheckedShaderModule(device, SHADOW_DEPTH_SHADER, 'SHADOW_DEPTH');
    const faceLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          // Lu aussi au fragment : c'est lui qui écarte l'enveloppe de l'émetteur.
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: FACE_BYTES },
        },
      ],
    });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [pageLayout, faceLayout] });
    const depthState = (compare: GPUCompareFunction): GPUDepthStencilState => ({
      format: 'depth32float',
      depthWriteEnabled: true,
      depthCompare: compare,
    });
    const depth = device.createRenderPipeline({
      label: 'WG shadow depth v1',
      layout,
      vertex: { module, entryPoint: 'shadow_vs' },
      // Aucune cible de couleur : l'étage de fragment n'existe que pour écarter la découpe d'un
      // matériau à masque d'opacité, et ne rend rien.
      fragment: { module, entryPoint: 'shadow_fs', targets: [] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: depthState('less'),
    });
    const clear = device.createRenderPipeline({
      label: 'WG shadow slice clear v1',
      layout,
      vertex: { module, entryPoint: 'shadow_clear_vs' },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: depthState('always'),
    });
    const faceGroup = device.createBindGroup({
      layout: faceLayout,
      entries: [{ binding: 0, resource: { buffer: faceUniform, size: FACE_BYTES } }],
    });
    const view = texture.createView();
    return {
      size,
      texture,
      view,
      sliceBuffer,
      depth,
      clear,
      faceGroup,
      faceStride: FACE_STRIDE,
      allocationBytes: shadowAtlasBytes() + faceUniform.size + sliceBuffer.size,
      /**
       * Écrit une région dans les deux tampons : celui des matrices de l'image, lu par décalage
       * dynamique, et celui des tranches, relu par la résolution différée. La matrice est celle de
       * la face entière, jamais celle de la région : c'est ce qui rend le dessin par pages identique
       * au bit près. `matrices` la porte à `matrixBase` ; rien n'est copié dans un tableau
       * intermédiaire, et deux régions d'une même face y réécrivent les mêmes nombres.
       *
       * `center` et `radius` disent l'enveloppe de la lampe au seul tampon qui la lit, celui du
       * dessin : le shader d'ombre n'écrit aucune profondeur pour une surface qui y est enfermée.
       * Une lampe sans enveloppe — une directionnelle, ou une lampe sans rayon déclaré — porte un
       * rayon nul, et la comparaison ne retire alors rien.
       */
      writeRegion(
        index: number,
        slice: number,
        face: number,
        matrices: Float32Array,
        matrixBase: number,
        rects: Int32Array,
        center: readonly number[] | undefined,
        radius: number,
      ) {
        const rect = slice * RECTS_PER_SLICE + face * 3,
          x = rects[rect] / size,
          y = rects[rect + 1] / size,
          side = rects[rect + 2];
        const uniform = (index * FACE_STRIDE) / 4,
          entry = slice * SHADOW_SLICE_FLOATS + face * SHADOW_FACE_FLOATS;
        for (let i = 0; i < 16; i++) {
          facePacked[uniform + i] = matrices[matrixBase + i];
          slicePacked[entry + i] = matrices[matrixBase + i];
        }
        const span = side / size;
        facePacked[uniform + 16] = x;
        facePacked[uniform + 17] = y;
        facePacked[uniform + 18] = span;
        facePacked[uniform + 19] = side;
        slicePacked[entry + 16] = x;
        slicePacked[entry + 17] = y;
        slicePacked[entry + 18] = span;
        slicePacked[entry + 19] = side > 0 ? 1 : 0;
        facePacked[uniform + 20] = center ? center[0] : 0;
        facePacked[uniform + 21] = center ? center[1] : 0;
        facePacked[uniform + 22] = center ? center[2] : 0;
        facePacked[uniform + 23] = center ? radius : 0;
        return side;
      },
      flushRegions(count: number) {
        if (count)
          device.queue.writeBuffer(faceUniform, 0, facePacked, 0, (count * FACE_STRIDE) / 4);
      },
      /** L'entête d'une tranche : faces, demi-ouverture tangente, côté en texels, plan proche. */
      writeSliceInfo(slice: number, faces: number, tanHalfFov: number, side: number, near: number) {
        const base = slice * SHADOW_SLICE_FLOATS + POINT_FACES * SHADOW_FACE_FLOATS;
        slicePacked[base] = faces;
        slicePacked[base + 1] = tanHalfFov;
        slicePacked[base + 2] = side;
        slicePacked[base + 3] = near;
      },
      /**
       * Repousse les tranches que l'ordonnanceur vient de redessiner, et elles seules : les autres
       * décrivent déjà l'image côté carte. L'atlas écrit ce qu'on lui donne et ne tient pas la liste
       * de ce qu'il a écrit — celui qui décide quoi redessiner la connaît déjà.
       */
      flushSlices(slices: Int32Array, count: number) {
        for (let i = 0; i < count; i++) {
          const first = slices[i] * SHADOW_SLICE_FLOATS;
          device.queue.writeBuffer(sliceBuffer, first * 4, slicePacked, first, SHADOW_SLICE_FLOATS);
        }
      },
      dispose: release,
    };
  } catch (error) {
    release();
    throw error;
  }
}
