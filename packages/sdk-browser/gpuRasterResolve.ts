import type { GpuRasterInput } from './gpuRasterTypes.ts';
import { DEPTH_COMPARE_OR_EQUAL } from './depthConvention.ts';
import { VIS_UNIFORM_BYTES } from './visibilityPageWgsl.ts';

const RESOLVE_DEPTH = {
  format: 'depth32float' as const,
  depthWriteEnabled: true,
  depthCompare: DEPTH_COMPARE_OR_EQUAL,
};

/**
 * Les résolutions matérielles plein écran du tampon de visibilité.
 *
 * Le raster matériel ouvre et efface les attachements — identifiants, profondeur opaque, niveau
 * zéro de la pyramide — et y pose ses triangles ; ces résolutions y fondent ensuite ceux du raster
 * de calcul, sous le même test de profondeur, en gardant ce qui s'y trouve (`load`). Un pixel que
 * les deux producteurs atteignent revient au plus proche, et à égalité au calcul, qui passe en
 * dernier : `greater-equal`, sinon la seconde résolution perdrait la profondeur que la première
 * venait de poser.
 *
 * `encodeHiz` sert entre les deux moitiés : elle pose la profondeur des occulteurs du calcul dans
 * le niveau zéro et le tampon, avant qu'aucun identifiant ne soit départagé.
 */
export function createRasterResolves(
  device: GPUDevice,
  code: string,
  work: GPUBuffer,
  targetBytes: number,
) {
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ],
  });
  const module = device.createShaderModule({ code });
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const vertex = { module, entryPoint: 'vs' };
  const primitive = { topology: 'triangle-list' as const };
  const makeFinal = (two: boolean) =>
    device.createRenderPipeline({
      layout: pipelineLayout,
      vertex,
      fragment: {
        module,
        entryPoint: two ? 'two' : 'one',
        targets: two
          ? [{ format: 'r32uint' as const }, { format: 'r32float' as const }]
          : [{ format: 'r32uint' as const }],
      },
      primitive,
      depthStencil: RESOLVE_DEPTH,
    });
  const one = makeFinal(false),
    two = makeFinal(true);
  const hizOnly = device.createRenderPipeline({
    layout: pipelineLayout,
    vertex,
    fragment: { module, entryPoint: 'hiz', targets: [{ format: 'r32float' as const }] },
    primitive,
    depthStencil: RESOLVE_DEPTH,
  });
  let group: GPUBindGroup | undefined;
  const bound = (uniform: GPUBuffer) =>
    (group ??= device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: work, offset: 0, size: targetBytes } },
        { binding: 1, resource: { buffer: uniform, offset: 0, size: VIS_UNIFORM_BYTES } },
      ],
    }));
  /** Une pièce jointe de couleur gardée telle que le raster matériel l'a laissée. */
  const kept = (view: GPUTextureView) => ({
    view,
    loadOp: 'load' as const,
    storeOp: 'store' as const,
  });
  const depthKept = (view: GPUTextureView) => ({
    view,
    depthLoadOp: 'load' as const,
    depthStoreOp: 'store' as const,
  });
  /**
   * Les deux descripteurs de passe, gardés tels quels jusqu'au prochain jeu de vues. Ils ne
   * dépendent que des vues, et les vues ne changent qu'au redimensionnement de la cible — qui
   * libère ce raster tout entier. Les reconstruire par image allouait sept objets pour réécrire
   * les mêmes champs.
   */
  let idsFor: GPUTextureView | undefined,
    depthFor: GPUTextureView | undefined,
    hizFor: GPUTextureView | undefined,
    hizPass: GPURenderPassDescriptor | undefined,
    finalPass: GPURenderPassDescriptor | undefined;
  /** Refait les deux descripteurs quand, et seulement quand, une des trois vues a changé. */
  const refresh = (input: GpuRasterInput) => {
    if (idsFor === input.idsView && depthFor === input.depthView && hizFor === input.hizView)
      return;
    idsFor = input.idsView;
    depthFor = input.depthView;
    hizFor = input.hizView;
    hizPass = {
      label: 'WG raster occluder hiz',
      colorAttachments: [kept(input.hizView!)],
      depthStencilAttachment: depthKept(input.depthView),
    };
    finalPass = {
      label: 'WG raster resolve',
      colorAttachments: input.hizView
        ? [kept(input.idsView), kept(input.hizView)]
        : [kept(input.idsView)],
      depthStencilAttachment: depthKept(input.depthView),
    };
  };
  return {
    /** La profondeur des occulteurs du calcul, dans le niveau zéro que la pyramide réduit et dans le
     *  tampon de profondeur ; aucun identifiant. */
    encodeHiz(encoder: GPUCommandEncoder, input: GpuRasterInput, width: number, height: number) {
      refresh(input);
      const pass = encoder.beginRenderPass(hizPass!);
      pass.setViewport(0, 0, width, height, 0, 1);
      pass.setPipeline(hizOnly);
      pass.setBindGroup(0, bound(input.uniform));
      pass.draw(3);
      pass.end();
    },
    /** L'image close : identifiants, profondeur, et la pyramide remise à la coupe entière. */
    encodeFinal(encoder: GPUCommandEncoder, input: GpuRasterInput, width: number, height: number) {
      refresh(input);
      const pass = encoder.beginRenderPass(finalPass!);
      pass.setViewport(0, 0, width, height, 0, 1);
      pass.setPipeline(input.hizView ? two : one);
      pass.setBindGroup(0, bound(input.uniform));
      pass.draw(3);
      pass.end();
    },
  };
}
