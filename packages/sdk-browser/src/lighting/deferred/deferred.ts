import { encodeReflectionSource } from '../../reflections/encode.ts';
import type { ScreenReflection } from '../../reflections/gpu.ts';
import type { SurfaceBuffer } from '../../scene/surfaceBuffer.ts';
import { SUN_WINDOW } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { UNLIT_COMPOSITIONS, UNLIT_LIGHTING_SHADER } from './shaders.ts';
import { createContractVariants, type ContractVariantOptions } from './contractVariants.ts';
import { createDeferredPlaceholders } from './setup.ts';
import {
  createDeferredProgram,
  type ComposedImage,
  type DeferredProgram,
  type DirectLightResources,
} from './program.ts';
import { ZERO_DIRECT, createDeferredView } from './view.ts';
export { FULLSCREEN_VERTEX } from './shaders.ts';

/** Label of the measured pass; `gpuLightingMs` is read under this name. */
export const DEFERRED_LIGHTING_PASS = 'Trillion3D deferred lighting';

/** The lit programs: when `precompile`, those a first frame asks for compile from the start beside
 *  the unlit one (#1362), without bounce always, with it too when `bounce`; `onFailure` hears any
 *  contract compile that fails, precompiled or asked later. */
export type LitPrograms = ContractVariantOptions & {
  precompile: boolean;
  bounce: boolean;
};

/** The contract program these resources light with: with bounce, narrow, unshadowed, rectless. */
const contractOf = (d: DirectLightResources) =>
  [!!d.bounceGrid && !!d.probes, !!d.narrow, !!d.unshadowed, !!d.rectless] as const;

/** Deferred and frozen-source lighting programs: the lit ones from the start when `lit` says so,
 *  else compiled lazily for the active lighting mode. */
export async function createDeferredLighting(
  device: GPUDevice,
  onReady?: () => void,
  pages = SUN_WINDOW,
  lit?: LitPrograms,
) {
  const view = createDeferredView(device);
  const placeholders = createDeferredPlaceholders(device);
  const bindings = { uniform: view.buffer, placeholders };
  // Programs, never a branch: the unlit view, and the contract ones (`contractVariants.ts`).
  const variants = createContractVariants(device, bindings, pages, onReady, lit);
  // A narrow program starts its wide twin: the first frame finds either width ready. Prepare waits
  // for the one without bounce, which lights any first frame; the bounce pair lands meanwhile.
  const litReady = lit?.precompile ? variants.precompile(false) : Promise.resolve();
  if (lit?.precompile && lit.bounce) void variants.precompile(true);
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
    let active: DeferredProgram = unlit;
    // Diagnostic views output raw values: no ACES, no sRGB, no composed background. The
    // indirect-irradiance view is one, and lighting says so, not the caller.
    let rawOutput = false;
    /** The size this image draws, from `update`: its targets may be larger (`renderScale.ts`). */
    const drawn = [1, 1];
    return {
      uniform: view.buffer,
      /** What an absent contract resource is worth: the blend pass binds the same. */
      placeholders,
      /** Outputs the image in raw values, without the display chain. For a measurement view. */
      setRawOutput(value: boolean) {
        rawOutput = value;
      },
      /** Settled once the lit program prepare started has landed, or failed (`LitPrograms`). */
      litReady,
      get usesContract() {
        return active !== unlit;
      },
      setJitter: view.setJitter,
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
        drawn[0] = width;
        drawn[1] = height;
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
        // A program still compiling lends the frame the best one ready (`contractVariants.ts`).
        active = (wantsContract && variants.pick(...contractOf(direct), onFailure)) || unlit;
        active.bind(surface, depth, hdr, direct);
      },
      settle() {
        return variants.settle();
      },
      /** What a frame lit with these resources waits for: the lit program's compile while no ready
       *  one can light it, else nothing (`contractVariants.ts`). */
      awaited(direct: DirectLightResources) {
        return variants.awaited(...contractOf(direct));
      },
      /** Draws the lighting, after the reflection source when the frame's program reflects, the
       *  next image's source then written beside it; returns the passes drawn (#1157). */
      light(
        encoder: GPUCommandEncoder,
        target: GPUTextureView,
        reflection?: ScreenReflection,
      ): number {
        const group = active.lightGroup;
        if (!group) throw new Error('SURFACE_NOT_BOUND');
        const reflected = reflection?.active && active.reflection;
        if (reflected) encodeReflectionSource(encoder, target, reflection, reflected, group, drawn);
        const colorAttachments: GPURenderPassColorAttachment[] = [
          { view: target, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] },
        ];
        const source = reflected && reflection.source?.target;
        if (source) colorAttachments.push({ ...colorAttachments[0], view: source });
        const pass = encoder.beginRenderPass({ label: DEFERRED_LIGHTING_PASS, colorAttachments });
        pass.setViewport(0, 0, drawn[0], drawn[1], 0, 1);
        pass.setPipeline(reflected ? reflected.final : active.light);
        if (reflected) pass.setBindGroup(1, reflection.group);
        pass.setBindGroup(0, group);
        pass.draw(3);
        pass.end();
        return reflected ? (reflection.history && !reflection.history.reuse ? 4 : 2) : 1;
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
        variants.release();
      },
    };
  } catch (error) {
    view.dispose();
    placeholders.dispose();
    variants.release();
    throw error;
  }
}
