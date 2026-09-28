import type { ScreenReflection } from '../../reflections/gpu.ts';
import type { SurfaceBuffer } from '../../scene/surfaceBuffer.ts';
import {
  BOUNCE_LIGHTING_SHADER,
  CONTRACT_COMPOSITIONS,
  DIRECT_LIGHTING_SHADER,
  UNLIT_COMPOSITIONS,
  UNLIT_LIGHTING_SHADER,
} from './shaders.ts';
import { createDeferredPlaceholders } from './setup.ts';
import {
  createDeferredProgram,
  type ComposedImage,
  type DeferredProgram,
  type DirectLightResources,
} from './program.ts';
import { ZERO_DIRECT, createDeferredView } from './view.ts';
export { DIRECT_LIGHTING_SHADER, FULLSCREEN_VERTEX } from './shaders.ts';

/** Label of the measured pass; `gpuLightingMs` is read under this name. */
export const DEFERRED_LIGHTING_PASS = 'Trillion3D deferred lighting';

/** Deferred and frozen-source lighting programs, compiled lazily for the active lighting mode. */
export async function createDeferredLighting(device: GPUDevice, onReady?: () => void) {
  const view = createDeferredView(device);
  const uniform = view.buffer;
  const placeholders = createDeferredPlaceholders(device);
  const bindings = { uniform, placeholders };
  try {
    const unlit = await createDeferredProgram(
      device,
      // The unlit view composes by identity: with no declared source, no radiance is to be
      // exposed or brought into the display range, and albedo must be read as-is (P6).
      {
        lighting: UNLIT_LIGHTING_SHADER,
        compose: UNLIT_COMPOSITIONS,
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
      get usesContract() {
        return active !== unlit;
      },
      /** Writes the view uniform of this image (`view.ts`). */
      update(
        inverseViewProjection: ArrayLike<number>,
        camera: readonly number[],
        width: number,
        height: number,
        clearColor: number,
        diagnostic: boolean,
        direct: ArrayLike<number> = ZERO_DIRECT,
        sampledRank = 0,
      ) {
        const raw = diagnostic || rawOutput;
        view.write(
          inverseViewProjection,
          camera,
          width,
          height,
          clearColor,
          raw,
          direct,
          sampledRank,
        );
      },
      /** Select and lazily compile the active lighting program. */
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
              compose: CONTRACT_COMPOSITIONS,
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
      settle() {
        return Promise.all([variants.direct.pending, variants.bounce.pending]).then(() => {});
      },
      light(encoder: GPUCommandEncoder, target: GPUTextureView, reflection?: ScreenReflection) {
        const group = active.lightGroup;
        if (!group) throw new Error('SURFACE_NOT_BOUND');
        const reflected = reflection?.active && active.reflection;
        if (reflected) {
          const source = encoder.beginRenderPass({
            colorAttachments: [
              {
                view: reflection.view,
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: [0, 0, 0, 0],
              },
            ],
          });
          source.setPipeline(reflected.source);
          source.setBindGroup(0, group);
          source.draw(3);
          source.end();
        }
        const pass = encoder.beginRenderPass({
          label: DEFERRED_LIGHTING_PASS,
          colorAttachments: [
            { view: target, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] },
          ],
        });
        pass.setPipeline(reflected ? reflected.final : active.light);
        if (reflected) pass.setBindGroup(1, reflection.group);
        pass.setBindGroup(0, group);
        pass.draw(3);
        pass.end();
      },
      /** True once the frame's program composes the chain's last bloom in (#963); the first call
       *  compiles what it needs, and `fail` hears why it cannot. */
      composesBloom: (fail: (error: unknown) => void) => active.compositions.composesBloom(fail),
      /** Composes the lit image, or `composed`: the temporal output, or the effect chain's, with
       *  the bloom blend it left; reading no as-is share when `asIs` says none is in the frame. */
      compose(
        encoder: GPUCommandEncoder,
        target: GPUTextureView,
        clear: GPUColor,
        presentation?: GPUTextureView,
        composed?: ComposedImage,
        asIs = true,
      ) {
        const composition = active.composition(composed, asIs);
        if (!composition) throw new Error('SURFACE_NOT_BOUND');
        const colorAttachments: GPURenderPassColorAttachment[] = [
          { view: target, loadOp: 'clear', storeOp: 'store', clearValue: clear },
        ];
        if (presentation) colorAttachments.push({ ...colorAttachments[0], view: presentation });
        const pass = encoder.beginRenderPass({
          label: presentation
            ? 'Trillion3D HDR composition + present'
            : 'Trillion3D HDR composition',
          colorAttachments,
        });
        const blend = composed?.bloom,
          { draw, present } = active.compositions.pipelines(composition.input, !!blend);
        pass.setPipeline(presentation ? present : draw);
        pass.setBindGroup(0, composition.group);
        if (blend) pass.setBindGroup(1, blend.group, [blend.offset]);
        pass.draw(3);
        pass.end();
      },
      dispose() {
        view.dispose();
        placeholders.dispose();
        unlit.release();
        variants.direct.program?.release();
        variants.bounce.program?.release();
      },
    };
  } catch (error) {
    view.dispose();
    placeholders.dispose();
    throw error;
  }
}
