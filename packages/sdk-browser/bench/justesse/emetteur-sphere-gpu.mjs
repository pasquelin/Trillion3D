// Justesse de l'exclusion sphérique de l'émetteur, réellement exécutée dans Chromium WebGPU.
//
// La formule est celle de `shadow_fs` (gpuShadowShader.ts) au caractère près : l'écart au carré au
// centre de l'émetteur contre le rayon au carré. Elle tourne ici sur un seul triangle occultant par
// cas, à la place exacte de la reproduction mathématique de l'audit (VERIFICATION_STABILISATION_
// 5896648_2026-09-16, défaut 4) : (0,19 ; 0,18 ; 0,17) m, à 0,3121 m d'une lampe de rayon 0,20 m,
// hors de la sphère ; (0,19 ; 0 ; 0) m, à 0,19 m, dedans. Le triangle est grand à l'écran pour
// rasteriser de façon fiable ; sa position au monde, elle, est la même à ses trois sommets — c'est
// le seul point que le nuanceur évalue, exactement celui de la reproduction.
//
// node --experimental-strip-types packages/sdk-browser/bench/justesse/emetteur-sphere-gpu.mjs
//   [<cache>/native/full/<clé>/lights.json]
// (LAB_ROOT désigne `render-tech-lab` si le dépôt n'est pas son voisin.)
//
// Sans argument, le centre et le rayon sont ceux de la reproduction, écrits ici. Avec le
// `lights.json` qu'une compilation vient de publier, ils sortent de la première lampe qui porte un
// `emitterRadius` : la chaîne complète — fixture, compilateur, nuanceur — est alors éprouvée sans
// qu'une valeur soit recopiée à la main. Les points d'essai restent relatifs au centre de la lampe.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dansPageWebgpu } from './pageWebgpu.mjs';
import { DEPTH_CLEAR, DEPTH_COMPARE } from '../../depthConvention.ts';

/** Le centre et le rayon de la lampe : ceux du produit de cache donné, sinon ceux de l'audit. */
function emetteur(chemin) {
  if (!chemin) return { centre: [0, 0, 0], rayon: 0.2, source: 'reproduction' };
  const fichier = JSON.parse(readFileSync(chemin, 'utf8'));
  const lampe = (fichier.lights ?? []).find((light) => typeof light.emitterRadius === 'number');
  assert.ok(lampe, `aucune lampe ne porte emitterRadius dans ${chemin}`);
  return { centre: lampe.position, rayon: lampe.emitterRadius, source: chemin };
}

const SHADER = `struct Uni{emitter:vec4f,}
@group(0) @binding(0) var<uniform> uni:Uni;
struct VsOut{@builtin(position) position:vec4f,@location(0) fromEmitter:vec3f,}
@vertex fn vs(@location(0) screen:vec2f,@location(1) world:vec3f)->VsOut{
 var out:VsOut;out.position=vec4f(screen,0.5,1.0);out.fromEmitter=world-uni.emitter.xyz;return out;
}
@fragment fn fs(in:VsOut){
 let radius=uni.emitter.w;
 // Identique à shadow_fs (gpuShadowShader.ts) : l'exclusion est exactement la sphère annoncée.
 if(radius>0.0&&dot(in.fromEmitter,in.fromEmitter)<radius*radius){discard;}
}`;

/** Exécuté dans la page : un pipeline de profondeur seule, un triangle par cas, la carte relue. */
async function executer({ shader, cas, size, triangle }) {
  const appareil = await globalThis.ouvrirAppareil();
  if (!appareil) return { indisponible: 'aucun adaptateur WebGPU' };
  const { device, erreurs } = appareil;
  const { module, compilation } = await appareil.compile(shader);
  if (compilation.length) return { compilation, erreurs };
  const layout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      },
    ],
  });
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const buffers = [
    { arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] },
    { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] },
  ];
  const pipeline = device.createRenderPipeline({
    layout: pipelineLayout,
    vertex: { module, entryPoint: 'vs', buffers },
    fragment: { module, entryPoint: 'fs', targets: [] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: DEPTH_COMPARE },
  });
  const screenBuffer = device.createBuffer({
    size: triangle.length * 4,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(screenBuffer, 0, new Float32Array(triangle));
  const bytesPerRow = size * 4;
  const resultats = [];
  for (const { nom, emitter, world } of cas) {
    const worldBuffer = device.createBuffer({
      size: 36,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(worldBuffer, 0, new Float32Array([...world, ...world, ...world]));
    const uniform = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(uniform, 0, new Float32Array(emitter));
    const group = device.createBindGroup({
      layout,
      entries: [{ binding: 0, resource: { buffer: uniform } }],
    });
    const depthTexture = device.createTexture({
      size: [size, size],
      format: 'depth32float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [],
      depthStencilAttachment: {
        view: depthTexture.createView(),
        depthClearValue: DEPTH_CLEAR,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.setVertexBuffer(0, screenBuffer);
    pass.setVertexBuffer(1, worldBuffer);
    pass.draw(3);
    pass.end();
    const readBuffer = device.createBuffer({
      size: bytesPerRow * size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    encoder.copyTextureToBuffer(
      { texture: depthTexture, aspect: 'depth-only' },
      { buffer: readBuffer, bytesPerRow, rowsPerImage: size },
      [size, size, 1],
    );
    device.queue.submit([encoder.finish()]);
    await readBuffer.mapAsync(GPUMapMode.READ);
    const depths = Array.from(new Float32Array(readBuffer.getMappedRange()));
    readBuffer.unmap();
    resultats.push({ nom, min: Math.min(...depths), max: Math.max(...depths) });
    depthTexture.destroy();
    readBuffer.destroy();
    worldBuffer.destroy();
    uniform.destroy();
  }
  screenBuffer.destroy();
  const info = await appareil.fermer();
  return { adaptateur: info.court, resultats, erreurs };
}

const { centre, rayon, source } = emetteur(process.argv[2]);
const au = (offset) => centre.map((axe, i) => axe + offset[i]);
const cas = [
  { nom: 'diagonale-hors-sphere', emitter: [...centre, rayon], world: au([0.19, 0.18, 0.17]) },
  { nom: 'dans-la-sphere', emitter: [...centre, rayon], world: au([0.19, 0, 0]) },
  { nom: 'sans-rayon-meme-point', emitter: [...centre, 0], world: au([0.19, 0, 0]) },
];
// 64 texels : `bytesPerRow` (4 octets par texel de profondeur) doit être un multiple de 256.
const argument = { shader: SHADER, cas, size: 64, triangle: [-0.8, -0.8, 0.8, -0.8, 0.0, 0.8] };
const resultat = await dansPageWebgpu(executer, argument, {
  titre: 'WebGeometry exclusion sphérique',
});
console.log(JSON.stringify({ source, centre, rayon, ...resultat }, null, 2));

assert.equal(resultat.indisponible ?? null, null, String(resultat.indisponible));
assert.deepEqual(resultat.compilation ?? [], []);
assert.deepEqual(resultat.erreurs, []);
const par = Object.fromEntries(resultat.resultats.map((r) => [r.nom, r]));
assert.ok(
  par['diagonale-hors-sphere'].min < 1,
  'le point diagonal, hors sphère, doit porter son ombre (profondeur écrite)',
);
assert.equal(
  par['dans-la-sphere'].min,
  1,
  'le point à 0,19 m, dans la sphère, ne doit rien écrire',
);
assert.equal(par['dans-la-sphere'].max, 1);
assert.ok(
  par['sans-rayon-meme-point'].min < 1,
  'une lampe sans rayon ne doit rien exclure, même au même point',
);

console.log(
  'OK : exclusion sphérique de l’émetteur réellement exécutée — voir emetteur-sphere-gpu.mjs',
);
