/** Full mip chain length for a texture of the given size. */
export function mipLevelCountFor(width: number, height: number) {
  return 1 + Math.floor(Math.log2(Math.max(width, height)));
}

/**
 * La disposition et le programme de réduction, construits UNE FOIS par appareil et par format.
 *
 * La chaîne de mips est engendrée à chaque texture de travail : recompiler le même programme et
 * la même disposition à chacune faisait payer une compilation de pipeline par texture, sur le
 * chemin même qui doit servir ses tuiles au plus vite. Le cache est tenu par appareil,
 * donc un appareil perdu emporte ses pipelines avec lui.
 */
type MipPipeline = { layout: GPUBindGroupLayout; pipeline: GPURenderPipeline };
const pipelines = new WeakMap<GPUDevice, Map<GPUTextureFormat, MipPipeline>>();

/**
 * Les couleurs sont moyennées, l'alpha est la MÉDIANE des quatre texels — jamais leur moyenne.
 *
 * L'alpha d'une carte de feuillage n'est pas une couleur : c'est ce qu'un matériau à masque compare
 * à son seuil. Une moyenne tire chaque niveau vers l'alpha moyen de la carte ; au-dessus du seuil,
 * la silhouette grossit d'un niveau à l'autre jusqu'à ce que le quad entier passe le test, perde ses
 * trous et se peigne en rectangle opaque devant ce qui est derrière — ce que le chargement rendait
 * visible, puisque la découpe lit alors le niveau le plus fin RÉSIDENT, donc un niveau grossier.
 *
 * La médiane de quatre valeurs, elle, passe un seuil DONNÉ exactement quand deux des quatre texels
 * le passent : le texel grossier est gardé quand la moitié de ce qu'il recouvre l'était, et la
 * couverture du seuil se conserve d'un niveau au suivant sans dépendre du seuil. C'est ce qui la
 * rend applicable ici : le seuil appartient au matériau, la chaîne de mips à une texture que
 * plusieurs matériaux partagent, et rien à cet endroit ne sait quel seuil lui sera appliqué.
 *
 * Triée décroissante, la médiane est la moyenne des deux valeurs du milieu : `u` est la deuxième,
 * `v` la troisième, six comparaisons sans tri ni branche.
 */
const MIP_SHADER = `
 @group(0) @binding(0) var source:texture_2d<f32>;
 @group(0) @binding(1) var<uniform> extent:vec4u;
 @vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{
  return vec4f(f32(i32(i&1u)*4-1),f32(i32(i>>1u)*4-1),0.0,1.0);
 }
 @fragment fn fs(@builtin(position) pos:vec4f)->@location(0) vec4f{
  let p=vec2i(pos.xy)*2;let hi=vec2i(extent.xy)-vec2i(1);
  let s0=textureLoad(source,min(p,hi),0);let s1=textureLoad(source,min(p+vec2i(1,0),hi),0);
  let s2=textureLoad(source,min(p+vec2i(0,1),hi),0);let s3=textureLoad(source,min(p+vec2i(1,1),hi),0);
  let mean=(s0+s1+s2+s3)*0.25;
  let u=min(max(s0.w,s1.w),max(s2.w,s3.w));
  let v=max(min(s0.w,s1.w),min(s2.w,s3.w));
  return vec4f(mean.rgb,(u+v)*0.5);
 }`;

function mipPipeline(device: GPUDevice, format: GPUTextureFormat): MipPipeline {
  let byFormat = pipelines.get(device);
  if (!byFormat) pipelines.set(device, (byFormat = new Map()));
  const held = byFormat.get(format);
  if (held) return held;
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ],
  });
  const module = device.createShaderModule({ code: MIP_SHADER });
  const built: MipPipeline = {
    layout,
    pipeline: device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    }),
  };
  byFormat.set(format, built);
  return built;
}

/**
 * Le tampon d'uniformes des réductions, gardé par appareil et agrandi au besoin.
 *
 * Le créer puis le détruire à chaque texture obligeait à attendre la fin du travail de l'appareil
 * avant de le rendre — un aller-retour complet de la file GPU par texture. Un tampon qui vit aussi
 * longtemps que l'appareil se réécrit dans l'ordre de la file, sans rien attendre.
 */
const uniformBuffers = new WeakMap<GPUDevice, { buffer: GPUBuffer; size: number }>();

function mipUniforms(device: GPUDevice, size: number) {
  const held = uniformBuffers.get(device);
  if (held && held.size >= size) return held.buffer;
  const buffer = device.createBuffer({
    label: 'WG texture mips uniforms',
    size,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  // L'ancien tampon n'est pas détruit : des passes déjà soumises peuvent encore le lire, et le
  // ramasse-miettes le rendra. L'agrandissement n'arrive qu'à la première texture plus grande.
  uniformBuffers.set(device, { buffer, size });
  return buffer;
}

/** Engendre la chaîne de mips d'une texture 2D : la couleur moyennée, l'alpha en médiane pour que
 * la couverture d'un seuil survive à chaque niveau. Les commandes sont soumises sans être
 * attendues : la file de l'appareil les exécute dans l'ordre, donc avant toute copie qui lira un
 * niveau. */
export function generateMaterialMips(
  device: GPUDevice,
  texture: GPUTexture,
  format: GPUTextureFormat,
  width: number,
  height: number,
) {
  const levels = mipLevelCountFor(width, height);
  if (levels === 1) return;
  const { layout, pipeline } = mipPipeline(device, format);
  const stride = Math.max(256, device.limits.minUniformBufferOffsetAlignment ?? 256);
  // Un uniforme par niveau réduit : l'étendue du niveau source, pour ne pas lire hors de l'image.
  const packed = new Uint32Array(((levels - 1) * stride) / 4);
  for (let level = 1; level < levels; level++) {
    const at = ((level - 1) * stride) / 4;
    packed[at] = Math.max(1, width >> (level - 1));
    packed[at + 1] = Math.max(1, height >> (level - 1));
  }
  const uniforms = mipUniforms(device, packed.byteLength);
  device.queue.writeBuffer(uniforms, 0, packed);
  const encoder = device.createCommandEncoder();
  const viewOf = (level: number) => texture.createView({ baseMipLevel: level, mipLevelCount: 1 });
  for (let level = 1; level < levels; level++) {
    const group = device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: viewOf(level - 1) },
        { binding: 1, resource: { buffer: uniforms, offset: (level - 1) * stride, size: 16 } },
      ],
    });
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: viewOf(level), loadOp: 'clear', storeOp: 'store' }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.draw(3);
    pass.end();
  }
  device.queue.submit([encoder.finish()]);
}
