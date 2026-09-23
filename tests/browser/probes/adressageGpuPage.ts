// Defect 4: WebGPU execution of wrap batches in a real Chromium. The harness and device opening
// are those of `pageWebgpu.ts` and `appareilWebgpu.ts`.
import { WRAP_COORD_WGSL } from '../../../packages/sdk-browser/visibilityWrapModes.ts';
import { dansPageWebgpu } from './pageWebgpu.ts';

/** One texture, as raw RGBA8 bytes, read into a `texture_2d_array` by every batch. */
interface Texture {
  largeur: number;
  hauteur: number;
  octets: number[];
}

/** One render: a texture, an addressing pair, a filtering mode, and the UV/flag pairs to sample. */
interface Lot {
  filtre: GPUFilterMode;
  texture: number;
  adresseS: GPUAddressMode;
  adresseT: GPUAddressMode;
  uv: number[];
  flags: number[];
}

interface ExecuterArgument {
  shader: string;
  textures: Texture[];
  lots: Lot[];
}

/** What `executer` returns across every path: no adapter, a compile error, or the readings. */
interface ExecuterResultat {
  indisponible?: string;
  adaptateur?: string;
  compilation?: string[];
  erreurs?: string[];
  sorties?: { moteur: number[]; three: number[] }[];
}

/** The bit that, in these benches only, asks for sample blending: nearest batches want one
 *  texel, linear batches the full read. `wrapUv` only reads the low nibble of the word, so this
 *  high bit cannot be confused with a wrap mode. */
export const MELANGE = 0x80000000;

/**
 * The batch shader: the engine wrap WGSL on one side, the native sampler set to the map mode on
 * the other. The four-sample blend is transcribed from the template `webgpuAtlasWgsl.ts` emits
 * for `colorSample`, `dataSample` and `colorAlpha`: same samples, same order, same expression.
 * One text for both wrap benches — two copies would be two chances for the exercised read to
 * drift from the production read.
 */
export const NUANCEUR_PRISES = `${WRAP_COORD_WGSL}
struct Cas{uv:vec2f,flags:u32,pad:u32,}
@group(0) @binding(0) var maps:texture_2d_array<f32>;
@group(0) @binding(1) var moteur:sampler;
@group(0) @binding(2) var three:sampler;
@group(0) @binding(3) var<storage,read> lot:array<Cas>;
struct Sortie{@location(0) moteur:vec4f,@location(1) three:vec4f,}
@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{
 let p=array(vec2f(-1.0,-1.0),vec2f(3.0,-1.0),vec2f(-1.0,3.0));return vec4f(p[i],0.0,1.0);
}
@fragment fn fs(@builtin(position) q:vec4f)->Sortie{
 let c=lot[u32(q.x)];
 let t=wrapUv(c.uv,c.flags,vec2f(textureDimensions(maps,0)));
 var lu=textureSampleLevel(maps,moteur,t.proche,0,0.0);
 if((c.flags&${MELANGE}u)!=0u&&t.couture){
  let s10=textureSampleLevel(maps,moteur,vec2f(t.loin.x,t.proche.y),0,0.0);
  let s01=textureSampleLevel(maps,moteur,vec2f(t.proche.x,t.loin.y),0,0.0);
  let s11=textureSampleLevel(maps,moteur,t.loin,0,0.0);
  lu=mix(mix(lu,s10,t.poids.x),mix(s01,s11,t.poids.x),t.poids.y);
 }
 return Sortie(lu,textureSampleLevel(maps,three,c.uv,0,0.0));
}`;

/**
 * In the page: one render per batch (texture, modes, filtering) onto two float targets, reread.
 * Target 0: the engine WGSL, sampler in clamp like the atlas. Target 1: the raw coordinate under
 * the sampler set to the map's mode, as Three sets it.
 */
async function executer({ shader, textures, lots }: ExecuterArgument): Promise<ExecuterResultat> {
  const appareil = await globalThis.ouvrirAppareil();
  if (!appareil) return { indisponible: 'aucun adaptateur WebGPU' };
  const { device, erreurs } = appareil;
  const { module, compilation } = await appareil.compile(shader);
  if (compilation.length) return { compilation, erreurs, sorties: [] };
  const cible: GPUColorTargetState = { format: 'rgba32float' };
  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module },
    fragment: { module, targets: [cible, cible] },
  });
  const cartes = textures.map(({ largeur, hauteur, octets }) => {
    const texture = device.createTexture({
      size: [largeur, hauteur, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    const data = new Uint8Array(octets);
    device.queue.writeTexture({ texture }, data, { bytesPerRow: largeur * 4 }, [largeur, hauteur]);
    return texture.createView({ dimension: '2d-array' });
  });
  const sorties: { moteur: number[]; three: number[] }[] = [];
  for (const lot of lots) {
    const n = lot.uv.length / 2,
      filtre = lot.filtre;
    const donnees = new ArrayBuffer(n * 16);
    const f = new Float32Array(donnees),
      u = new Uint32Array(donnees);
    for (let i = 0; i < n; i++) {
      f[i * 4] = lot.uv[i * 2];
      f[i * 4 + 1] = lot.uv[i * 2 + 1];
      u[i * 4 + 2] = lot.flags[i];
    }
    const tampon = device.createBuffer({
      size: n * 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(tampon, 0, donnees);
    const echantillonneur = (s: GPUAddressMode, t: GPUAddressMode) =>
      device.createSampler({
        addressModeU: s,
        addressModeV: t,
        magFilter: filtre,
        minFilter: filtre,
      });
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: cartes[lot.texture] },
        { binding: 1, resource: echantillonneur('clamp-to-edge', 'clamp-to-edge') },
        { binding: 2, resource: echantillonneur(lot.adresseS, lot.adresseT) },
        { binding: 3, resource: { buffer: tampon } },
      ],
    });
    const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC;
    const vues = [0, 1].map(() =>
      device.createTexture({ size: [n, 1], format: 'rgba32float', usage }),
    );
    const encodeur = device.createCommandEncoder();
    const passe = encodeur.beginRenderPass({
      colorAttachments: vues.map((t) => ({
        view: t.createView(),
        loadOp: 'clear',
        storeOp: 'store',
      })),
    });
    passe.setPipeline(pipeline);
    passe.setBindGroup(0, bindGroup);
    passe.draw(3);
    passe.end();
    const ligne = Math.ceil((n * 16) / 256) * 256;
    const relues = vues.map((texture) => {
      const usageLu = GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ;
      const b = device.createBuffer({ size: ligne, usage: usageLu });
      encodeur.copyTextureToBuffer({ texture }, { buffer: b, bytesPerRow: ligne }, [n, 1]);
      return b;
    });
    device.queue.submit([encodeur.finish()]);
    const lu: number[][] = [];
    for (const b of relues) {
      await b.mapAsync(GPUMapMode.READ);
      lu.push(Array.from(new Float32Array(b.getMappedRange().slice(0, n * 16))));
    }
    sorties.push({ moteur: lu[0], three: lu[1] });
  }
  // The GPU actually obtained, returned with the reading: a seam discrepancy depends on it.
  const info = await appareil.fermer();
  return { adaptateur: info.complet, compilation, erreurs, sorties };
}

/** Launches Chromium, runs the batches on a local page, closes. */
export async function executerDansChromium(argument: ExecuterArgument) {
  const resultat = await dansPageWebgpu(executer, argument, { titre: 'adressage' });
  if (resultat.indisponible) throw new Error(resultat.indisponible);
  const compilation = resultat.compilation ?? [];
  const erreurs = resultat.erreurs ?? [];
  if (compilation.length || erreurs.length)
    throw new Error(JSON.stringify({ compilation, erreurs }));
  // The GPU that produced the reading, recorded with it: a seam discrepancy depends on the adapter.
  console.log(`WebGPU adapter: ${resultat.adaptateur || 'unspecified'}`);
  return resultat.sorties ?? [];
}
