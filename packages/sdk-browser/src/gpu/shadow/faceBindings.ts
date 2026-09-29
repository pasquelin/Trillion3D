import { SHADOW_FACE_READ_BYTES as FACE_BYTES } from './recordPack.ts';

/** Bytes of the cutout request word: the feedback word, then whether the pass asks at all. */
const REQUEST_BYTES = 16;

/**
 * Group 1 of the shadow depth pass: the face uniform of each region, at a dynamic offset, and what
 * the cutout asks of the colour tiles (#1016). A masked caster's cutout reads its base map at the
 * shadow texel's level (`maskAlphaWgsl(true)`); a caster no camera pixel sees asked for nothing,
 * and the cutout read whatever the pool kept of earlier poses. The pass therefore posts the tiles
 * it reads into the texture feedback's own counters (`../../webgpu/tile/feedback.ts`), under the
 * word the image's passes carry — its phase, its pick turn, every texel during a convergence —:
 * the same readback, the same serving, the same barrier (`../../webgpu/tile/converge.ts`).
 */
export function createShadowFaceBindings(device: GPUDevice, faceUniform: GPUBuffer) {
  const layout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        // Also read at the fragment: it is what discards the emitter envelope.
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: FACE_BYTES },
      },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'storage' } },
    ],
  });
  const request = device.createBuffer({
    label: 'Trillion3D shadow cutout request word v1',
    size: REQUEST_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  // Counters with no texture streamed: the word says the pass asks nothing, never read.
  const none = device.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE });
  const words = new Uint32Array(REQUEST_BYTES / 4);
  let counters: GPUBuffer | undefined, group: GPUBindGroup | undefined;
  const groupOf = (target: GPUBuffer) =>
    device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: faceUniform, size: FACE_BYTES } },
        { binding: 1, resource: { buffer: request } },
        { binding: 2, resource: { buffer: target } },
      ],
    });
  return {
    layout,
    /** The group the regions bind, over the counters last given to `requests`. */
    get group() {
      return (group ??= groupOf(counters ?? none));
    },
    /** What this image's cutouts ask: `word` (`phaseWord`) into `target`, the texture feedback's
     *  counters; none without them. The group follows the counters' identity. */
    requests(word: number, target: GPUBuffer | undefined) {
      // Every shadow batch of an image carries the same word: written once, when it changes.
      if (words[0] !== word || words[1] !== (target ? 1 : 0)) {
        words[0] = word;
        words[1] = target ? 1 : 0;
        device.queue.writeBuffer(request, 0, words);
      }
      if (target && target !== counters) {
        counters = target;
        group = undefined;
      }
    },
    destroy() {
      request.destroy();
      none.destroy();
    },
  };
}
