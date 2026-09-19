import type { SurfaceBuffer } from './surfaceBuffer.ts';
import {
  BOUNCE_LIGHTING_SHADER,
  COMPOSE_SHADER,
  DIRECT_LIGHTING_SHADER,
  UNLIT_COMPOSE_SHADER,
  UNLIT_LIGHTING_SHADER,
} from './deferredLightingShaders.ts';
import { createDeferredPlaceholders } from './deferredLightingSetup.ts';
import {
  createDeferredProgram,
  type DeferredProgram,
  type DirectLightResources,
} from './deferredLightingProgram.ts';
export { DIRECT_LIGHTING_SHADER, FULLSCREEN_VERTEX } from './deferredLightingShaders.ts';

/** Label of the measured pass; `gpuLightingMs` is read under this name. */
export const DEFERRED_LIGHTING_PASS = 'WG deferred lighting';
/** With no declared light: zero lights, zero tiles, exposure 1. */
const ZERO_DIRECT = [0, 0, 0, 1] as const;

/**
 * Deferred resolve. Two programs live here: the unlit view — raw material albedo, composed
 * by identity, which is also what a scene with no declared light renders — and the contract
 * one, exposed then passed through ACES. The second is compiled only on the first frame that
 * carries a light: a scene that has none never pays for it.
 *
 * `onReady` is called on every arrival of a contract program, DIRECT as BOUNCE. That is the
 * only announcement of this frame change: compilation finishes between two frames, without
 * the caller having asked for anything, and the next frame would still render raw albedo if
 * no one said so. A program that arrives while its variant is no longer wanted causes one
 * more frame to be redone, never a wrong frame.
 */
export async function createDeferredLighting(
  device: GPUDevice,
  directLights: GPUBuffer,
  onReady?: () => void,
) {
  const uniform = device.createBuffer({
    label: 'WG deferred view v1',
    size: 128,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const placeholders = createDeferredPlaceholders(device);
  const bindings = { uniform, directLights, placeholders };
  try {
    const unlit = await createDeferredProgram(
      device,
      // The unlit view composes by identity: with no declared source, no radiance is to be
      // exposed or brought into the display range, and albedo must be read as-is (P6).
      {
        lighting: UNLIT_LIGHTING_SHADER,
        compose: UNLIT_COMPOSE_SHADER,
        label: 'UNLIT',
        direct: false,
      },
      bindings,
    );
    // Three programs, never a branch: the unlit view, the contract, and the contract plus
    // bounce. A session without bounce thus runs exactly the previous shader.
    type Variant = { program?: DeferredProgram; pending?: Promise<unknown> };
    const variants: Record<'direct' | 'bounce', Variant> = { direct: {}, bounce: {} };
    let active: DeferredProgram = unlit;
    const packed = new Float32Array(32);
    // Diagnostic views output raw values: no ACES, no sRGB, no composed background. The
    // indirect-irradiance view is one, and lighting says so, not the caller.
    let rawOutput = false;
    return {
      uniform,
      /** What an absent contract resource is worth: the blend pass binds the same. */
      placeholders,
      /** Outputs the image in raw values, without the display chain. For a measurement view. */
      setRawOutput(value: boolean) {
        rawOutput = value;
      },
      /** True when the current frame is rendered by a contract program. */
      get usesContract() {
        return active !== unlit;
      },
      update(
        inverseViewProjection: ArrayLike<number>,
        camera: readonly number[],
        width: number,
        height: number,
        clearColor: number,
        diagnostic: boolean,
        direct: ArrayLike<number> = ZERO_DIRECT,
      ) {
        packed.set(inverseViewProjection as ArrayLike<number> & number[], 0);
        packed.set(camera, 16);
        packed.set([width, height, diagnostic || rawOutput ? 1 : 0, 0], 20);
        packed.set(
          [(clearColor >> 16) / 255, ((clearColor >> 8) & 255) / 255, (clearColor & 255) / 255, 1],
          24,
        );
        // Contract lights, tiles in X and Y, then exposure.
        packed.set(direct as number[], 28);
        device.queue.writeBuffer(uniform, 0, packed);
      },
      /**
       * Picks the frame program and binds its resources. `wantsContract` stays false as long as
       * the host has declared no light, or as long as it asks for the unlit view; compilation
       * of the contract program is started on the first request and the unlit view stays
       * correct while it finishes.
       */
      bind(
        surface: SurfaceBuffer,
        depth: GPUTextureView,
        hdr: GPUTextureView,
        wantsContract: boolean,
        direct: DirectLightResources = {},
        onFailure?: (error: unknown) => void,
      ) {
        const wantsBounce = wantsContract && !!direct.bounceGrid && !!direct.probes;
        const variant = variants[wantsBounce ? 'bounce' : 'direct'];
        if (wantsContract && !variant.program && !variant.pending)
          variant.pending = createDeferredProgram(
            device,
            {
              lighting: wantsBounce ? BOUNCE_LIGHTING_SHADER : DIRECT_LIGHTING_SHADER,
              compose: COMPOSE_SHADER,
              label: wantsBounce ? 'BOUNCE' : 'DIRECT',
              direct: true,
              bounce: wantsBounce,
            },
            bindings,
          ).then(
            (program) => {
              variant.program = program;
              onReady?.();
            },
            (error) => onFailure?.(error),
          );
        // The bounce program takes a frame or two to compile: the contract one renders
        // the frame while waiting, without bounce, rather than make the frame wait.
        active =
          (wantsContract ? (variant.program ?? variants.direct.program) : undefined) ?? unlit;
        active.bind(surface, depth, hdr, direct);
      },
      /** Waits for in-flight contract-program compiles, when there are any. */
      settle() {
        return Promise.all([variants.direct.pending, variants.bounce.pending]).then(() => {});
      },
      light(encoder: GPUCommandEncoder, target: GPUTextureView) {
        const group = active.lightGroup;
        if (!group) throw new Error('SURFACE_NOT_BOUND');
        const pass = encoder.beginRenderPass({
          label: DEFERRED_LIGHTING_PASS,
          colorAttachments: [
            { view: target, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] },
          ],
        });
        pass.setPipeline(active.light);
        pass.setBindGroup(0, group);
        pass.draw(3);
        pass.end();
      },
      /** Composes `source` — the lit image by default, or the temporal-antialiasing output. */
      compose(
        encoder: GPUCommandEncoder,
        target: GPUTextureView,
        clear: GPUColor,
        presentation?: GPUTextureView,
        source?: GPUTextureView,
      ) {
        const group = active.composeGroup(source);
        if (!group) throw new Error('SURFACE_NOT_BOUND');
        const colorAttachments: GPURenderPassColorAttachment[] = [
          { view: target, loadOp: 'clear', storeOp: 'store', clearValue: clear },
        ];
        if (presentation)
          colorAttachments.push({
            view: presentation,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: clear,
          });
        const pass = encoder.beginRenderPass({
          label: presentation ? 'WG HDR composition + present' : 'WG HDR composition',
          colorAttachments,
        });
        pass.setPipeline(presentation ? active.composePresent : active.compose);
        pass.setBindGroup(0, group);
        pass.draw(3);
        pass.end();
      },
      dispose() {
        uniform.destroy();
        placeholders.dispose();
        unlit.release();
        variants.direct.program?.release();
        variants.bounce.program?.release();
      },
    };
  } catch (error) {
    uniform.destroy();
    placeholders.dispose();
    throw error;
  }
}
