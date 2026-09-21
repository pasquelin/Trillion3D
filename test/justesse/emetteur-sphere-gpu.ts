// Correctness of spherical emitter exclusion, actually run in Chromium WebGPU.
//
// The formula is that of `shadow_fs` (gpuShadowShader.ts) to the character: squared distance
// to the emitter centre against the squared radius. It runs here on a single occluding
// triangle per case, at the exact place of the audit's mathematical reproduction
// (VERIFICATION_STABILISATION_5896648_2026-09-16, defect 4): (0.19; 0.18; 0.17) m, 0.3121 m
// from a lamp of radius 0.20 m, outside the sphere; (0.19; 0; 0) m, at 0.19 m, inside. The
// triangle is large on screen so rasterisation is reliable; its world position, though, is
// the same at all three vertices — that is the only point the shader evaluates, exactly
// that of the reproduction.
//
// node --experimental-strip-types test/justesse/emetteur-sphere-gpu.ts
//   [<cache>/native/full/<key>/lights.json]
//
// With no argument, centre and radius are those of the reproduction, written here. With the
// `lights.json` a compilation has just published, they come from the first lamp that carries
// an `emitterRadius`: the full chain — fixture, compiler, shader — is then exercised without
// any value being copied by hand. Trial points stay relative to the lamp centre.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dansPageWebgpu } from './pageWebgpu.ts';
import { DEPTH_CLEAR, DEPTH_COMPARE } from '../../packages/sdk-browser/depthConvention.ts';

/** Lamp centre and radius: those of the given cache product, otherwise those of the audit. */
function emetteur(chemin) {
  if (!chemin) return { centre: [0, 0, 0], rayon: 0.2, source: 'reproduction' };
  const fichier = JSON.parse(readFileSync(chemin, 'utf8'));
  const lampe = (fichier.lights ?? []).find((light) => typeof light.emitterRadius === 'number');
  assert.ok(lampe, `no lamp carries emitterRadius in ${chemin}`);
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
 // Identical to shadow_fs (gpuShadowShader.ts): exclusion is exactly the announced sphere.
 if(radius>0.0&&dot(in.fromEmitter,in.fromEmitter)<radius*radius){discard;}
}`;

/** Run in the page: a depth-only pipeline, one triangle per case, the map read back. */
async function executer({ shader, cas, size, triangle, depthCompare, depthClear }) {
  const appareil = await globalThis.ouvrirAppareil();
  if (!appareil) return { indisponible: 'no WebGPU adapter' };
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
    depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare },
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
        depthClearValue: depthClear,
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
// 64 texels: `bytesPerRow` (4 bytes per depth texel) must be a multiple of 256.
// `executer` is serialised then evaluated IN the page: the engine's depth convention enters
// there by argument, never by a closure over a Node import.
const argument = {
  shader: SHADER,
  cas,
  size: 64,
  triangle: [-0.8, -0.8, 0.8, -0.8, 0.0, 0.8],
  depthCompare: DEPTH_COMPARE,
  depthClear: DEPTH_CLEAR,
};
const resultat = await dansPageWebgpu(executer, argument, {
  titre: 'WebGeometry spherical exclusion',
});
console.log(JSON.stringify({ source, centre, rayon, ...resultat }, null, 2));

assert.equal(resultat.indisponible ?? null, null, String(resultat.indisponible));
assert.deepEqual(resultat.compilation ?? [], []);
assert.deepEqual(resultat.erreurs, []);
const par = Object.fromEntries(resultat.resultats.map((r) => [r.nom, r]));
// INVERTED depth: the map starts at far (`DEPTH_CLEAR`) and a fragment writes 0.5, so
// "a shadow is cast" is read on the MAXIMUM, and "nothing is written" on a map that stayed
// entirely at the clear value.
assert.ok(
  par['diagonale-hors-sphere'].max > DEPTH_CLEAR,
  'the diagonal point, outside the sphere, must cast its shadow (depth written)',
);
assert.equal(
  par['dans-la-sphere'].min,
  DEPTH_CLEAR,
  'the point at 0.19 m, inside the sphere, must write nothing',
);
assert.equal(par['dans-la-sphere'].max, DEPTH_CLEAR);
assert.ok(
  par['sans-rayon-meme-point'].max > DEPTH_CLEAR,
  'a lamp with no radius must exclude nothing, even at the same point',
);

console.log('OK: spherical emitter exclusion actually run — see emetteur-sphere-gpu.ts');
