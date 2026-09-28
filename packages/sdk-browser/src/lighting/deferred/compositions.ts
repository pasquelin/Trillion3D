import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts';
import { bloomLevelLayout } from '../../effects/bloomLevel.ts';
import type { ComposeInput } from './shaders.ts';
import { makeFullscreenPipeline } from './fullscreen.ts';

const INPUTS = ['still', 'accumulated', 'flagless'] as const satisfies readonly ComposeInput[];
/** A program's composition texts, one per input it reads the as-is share from (`AS_IS_READ`):
 *  plain, and blending in the chain's last bloom. */
export type CompositionSources = Record<'plain' | 'bloom', Record<ComposeInput, string>>;

/**
 * A program's composition pipelines, one per input — the flagless ones for a frame that reads no
 * as-is share (OMB-11) —: the plain ones, compiled with it, and those that blend the
 * chain's last bloom in (#963), compiled off the frame at the first that asks for them
 * (`composesBloom`) — a scene without bloom never pays for them.
 */
export async function createCompositions(
  device: GPUDevice,
  sources: CompositionSources,
  label: string,
) {
  const fragment = GPUShaderStage.FRAGMENT;
  // The image and the view, then the share read beside them — none for a flagless frame.
  const layout = (share?: GPUTextureSampleType) =>
    device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: fragment, texture: { sampleType: 'unfilterable-float' } },
        { binding: 1, visibility: fragment, buffer: { type: 'uniform' } },
        ...(share ? [{ binding: 2, visibility: fragment, texture: { sampleType: share } }] : []),
      ],
    });
  const layouts: Record<ComposeInput, GPUBindGroupLayout> = {
    still: layout('uint'),
    accumulated: layout('unfilterable-float'),
    flagless: layout(),
  };
  const display = { format: 'rgba8unorm' as const };
  /** One input's composition: into the capture target, or into it and the canvas at once. */
  const compile = async (input: ComposeInput, bloom = false) => {
    const name = `${label}_COMPOSE_${bloom ? 'BLOOM_' : ''}${input.toUpperCase()}`;
    const code = sources[bloom ? 'bloom' : 'plain'][input];
    const module = await createCheckedShaderModule(device, code, name);
    const groups = bloom ? [layouts[input], bloomLevelLayout(device)] : layouts[input];
    const [draw, present] = await Promise.all([
      makeFullscreenPipeline(device, module, groups, 'compose', [display]),
      makeFullscreenPipeline(device, module, groups, 'composePresent', [
        display,
        { format: 'bgra8unorm' },
      ]),
    ]);
    return { draw, present };
  };
  type Pipelines = Awaited<ReturnType<typeof compile>>;
  /** Every input's pipelines at once, so a frame switching inputs compiles nothing. */
  const compileAll = async (bloom = false) => {
    const [still, accumulated, flagless] = await Promise.all(
      INPUTS.map((input) => compile(input, bloom)),
    );
    return { still, accumulated, flagless };
  };
  const plain = await compileAll();
  let blended: Record<ComposeInput, Pipelines> | undefined, blending: Promise<void> | undefined;
  return {
    /** Each input's layout: the group a frame composes with is made on it. */
    layouts,
    /** True once the pipelines that blend a bloom in are compiled: the first call compiles them,
     *  and `fail` hears why they cannot be. Until then the bloom draws its own blend. */
    composesBloom(fail: (error: unknown) => void) {
      blending ??= compileAll(true).then((pipelines) => void (blended = pipelines), fail);
      return !!blended;
    },
    /** The pipelines of `input`, blending a bloom in once `composesBloom` said they exist. */
    pipelines(input: ComposeInput, bloom: boolean): Pipelines {
      if (!bloom) return plain[input];
      if (!blended) throw new Error('the bloom compositions are not compiled');
      return blended[input];
    },
  };
}
