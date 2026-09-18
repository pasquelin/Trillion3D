import { createCheckedShaderModule } from './gpuShaderModule.ts';
import { makeFullscreenPipeline } from './deferredLightingProgram.ts';
import { TAA_BINDINGS, TAA_PASS, TAA_SHADER, TAA_VIEW_BYTES } from './taaShaderWgsl.ts';
import { createTaaFrameState } from './taaFrame.ts';
import { createPlacementMotion, type MotionRoot } from './taaMotion.ts';
import { readOnly } from './webgpuBindLayout.ts';

/** Octets par pixel des deux cibles d'historique : deux `rgba16float`. */
export const TAA_HISTORY_BYTES_PER_PIXEL = 16;

/** Ce que la passe lit dans l'image : l'image éclairée et mélangée, la profondeur, les identifiants
 *  du tampon de visibilité, la table des fiches et les matrices de mouvement des placements. */
export interface TaaInputs {
  current: GPUTextureView;
  depth: GPUTextureView;
  ids: GPUTextureView;
  pages: GPUBuffer;
  motion: GPUBuffer;
}

function createTaaLayout(device: GPUDevice) {
  const fragment = GPUShaderStage.FRAGMENT;
  return device.createBindGroupLayout({
    entries: [
      {
        binding: TAA_BINDINGS.current,
        visibility: fragment,
        texture: { sampleType: 'unfilterable-float' },
      },
      { binding: TAA_BINDINGS.history, visibility: fragment, texture: { sampleType: 'float' } },
      {
        binding: TAA_BINDINGS.historySampler,
        visibility: fragment,
        sampler: { type: 'filtering' },
      },
      { binding: TAA_BINDINGS.depth, visibility: fragment, texture: { sampleType: 'depth' } },
      { binding: TAA_BINDINGS.ids, visibility: fragment, texture: { sampleType: 'uint' } },
      { binding: TAA_BINDINGS.pages, visibility: fragment, buffer: readOnly },
      { binding: TAA_BINDINGS.motion, visibility: fragment, buffer: readOnly },
      { binding: TAA_BINDINGS.view, visibility: fragment, buffer: { type: 'uniform' } },
    ],
  });
}

/**
 * La passe d'antialiasing temporel : deux cibles d'historique en ping-pong, l'une lue et l'autre
 * écrite à chaque image, et la composition lit celle qui vient d'être écrite. Les cibles suivent la
 * taille de l'image (`resize`) ; les groupes de liaison sont refaits quand une entrée change
 * d'identité, jamais par image.
 */
export async function createTemporalAntialiasing(device: GPUDevice, roots: readonly MotionRoot[]) {
  const layout = createTaaLayout(device);
  const module = await createCheckedShaderModule(device, TAA_SHADER, 'TAA_RESOLVE');
  const pipeline = await makeFullscreenPipeline(device, module, layout, 'resolve', ['rgba16float']);
  const motion = createPlacementMotion(device, roots);
  const uniform = device.createBuffer({
    label: 'WG TAA view v1',
    size: TAA_VIEW_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const sampler = device.createSampler({
    label: 'WG TAA history sampler',
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  });
  const textures: GPUTexture[] = [],
    views: GPUTextureView[] = [],
    groups: (GPUBindGroup | undefined)[] = [undefined, undefined];
  let width = 0,
    height = 0,
    /** La cible lue à la prochaine image : l'autre est écrite. */
    read = 0,
    bound: TaaInputs | undefined;
  const dropTargets = () => {
    for (const texture of textures) texture.destroy();
    textures.length = 0;
    views.length = 0;
    groups[0] = groups[1] = undefined;
  };
  return {
    uniform,
    motion,
    /** Octets des deux cibles telles qu'allouées : ce qu'une capture doit compter à côté des siennes. */
    get historyBytes() {
      return width * height * TAA_HISTORY_BYTES_PER_PIXEL * (textures.length ? 1 : 0);
    },
    /** Ce que la passe garde d'une image à l'autre côté processeur : gigue, historique, tenue. */
    frame: createTaaFrameState(),
    /** Vrai quand les cibles ont la taille demandée ; sinon elles sont refaites et l'historique
     *  n'existe plus. Rend vrai quand quelque chose a été réalloué. */
    resize(w: number, h: number) {
      if (w === width && h === height && textures.length === 2) return false;
      dropTargets();
      width = w;
      height = h;
      for (let i = 0; i < 2; i++) {
        const texture = device.createTexture({
          label: `WG TAA history ${i}`,
          size: { width: w, height: h },
          format: 'rgba16float',
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
        textures.push(texture);
        views.push(texture.createView());
      }
      bound = undefined;
      return true;
    },
    /**
     * Encode la passe : lit `inputs.current` et l'historique, écrit l'autre cible, puis échange les
     * rôles. L'uniforme doit avoir été écrit avant. Rend la vue écrite.
     */
    encode(encoder: GPUCommandEncoder, inputs: TaaInputs) {
      if (textures.length !== 2) throw new Error('TAA_TARGETS_MISSING');
      if (
        !bound ||
        bound.current !== inputs.current ||
        bound.depth !== inputs.depth ||
        bound.ids !== inputs.ids ||
        bound.pages !== inputs.pages ||
        bound.motion !== inputs.motion
      ) {
        bound = { ...inputs };
        for (let i = 0; i < 2; i++)
          groups[i] = device.createBindGroup({
            layout,
            entries: [
              { binding: TAA_BINDINGS.current, resource: inputs.current },
              { binding: TAA_BINDINGS.history, resource: views[i] },
              { binding: TAA_BINDINGS.historySampler, resource: sampler },
              { binding: TAA_BINDINGS.depth, resource: inputs.depth },
              { binding: TAA_BINDINGS.ids, resource: inputs.ids },
              { binding: TAA_BINDINGS.pages, resource: { buffer: inputs.pages } },
              { binding: TAA_BINDINGS.motion, resource: { buffer: inputs.motion } },
              { binding: TAA_BINDINGS.view, resource: { buffer: uniform } },
            ],
          });
      }
      const write = 1 - read;
      const pass = encoder.beginRenderPass({
        label: TAA_PASS,
        colorAttachments: [
          { view: views[write], loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] },
        ],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, groups[read]!);
      pass.draw(3);
      pass.end();
      read = write;
      return views[write];
    },
    dispose() {
      dropTargets();
      motion.dispose();
      uniform.destroy();
    },
  };
}

export type TemporalAntialiasing = Awaited<ReturnType<typeof createTemporalAntialiasing>>;
