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
/** Alignement d'un décalage dynamique d'uniforme : une face par entrée de 256 octets. */
const FACE_STRIDE = 256;
/** Faces au plus dans une image : quatre lampes remises à jour, six faces chacune. */
export const MAX_FACES_PER_FRAME = LIGHT_SETTINGS.shadowUpdatesPerFrame * POINT_FACES;
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
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const faceUniform = device.createBuffer({
    label: 'WG shadow faces v1',
    size: MAX_FACES_PER_FRAME * FACE_STRIDE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const sliceBuffer = device.createBuffer({
    label: 'WG shadow slices v1',
    size: MAX_SHADOW_SLICES * SHADOW_SLICE_FLOATS * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const slicePacked = new Float32Array(MAX_SHADOW_SLICES * SHADOW_SLICE_FLOATS);
  const facePacked = new Float32Array((MAX_FACES_PER_FRAME * FACE_STRIDE) / 4);
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
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 80 },
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
      entries: [{ binding: 0, resource: { buffer: faceUniform, size: 80 } }],
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
       * Écrit une face dans les deux tampons : celui des matrices de l'image, lu par décalage
       * dynamique, et celui des tranches, relu par la résolution différée. `matrices` porte la
       * matrice à `matrixBase` ; rien n'est copié dans un tableau intermédiaire.
       */
      writeFace(
        index: number,
        slice: number,
        face: number,
        matrices: Float32Array,
        matrixBase: number,
        rects: Int32Array,
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
        return side;
      },
      flushFaces(count: number) {
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
      flushSlices() {
        device.queue.writeBuffer(sliceBuffer, 0, slicePacked);
      },
      dispose: release,
    };
  } catch (error) {
    release();
    throw error;
  }
}
