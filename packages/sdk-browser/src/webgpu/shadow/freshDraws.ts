import { DEPTH_COMPARE } from '../../camera/depthConvention.ts';
import { preparedPipeline } from '../../lighting/deferred/fullscreen.ts';
import {
  SHADOW_TRANSLUCENT_DEPTH_FORMAT,
  SHADOW_TRANSMITTANCE_FORMAT,
  TRANSMITTANCE_BLEND,
} from '../../gpu/shadow/transmittance.ts';

/** Group 2's GPU page bindings: their views, the kept pairs, the arguments (`freshLayout.ts`). */
const freshEntries = (): GPUBindGroupLayoutEntry[] =>
  [1, 2, 3].map((binding) => ({
    binding,
    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
    buffer: { type: 'read-only-storage' },
  }));

/**
 * THE PIPELINES OF THE PAGES THE GPU DRAWS ITSELF (#1275), entries of the shadow depth shader
 * (`freshDrawsWgsl.ts`): into the pool, its pages' squares cleared (`clear`, depth always) then its
 * casters (`casters`, depth tested); into the transmittance layer, its pages cleared to all the
 * light (`tintClear`), then its blended casters depth only then colour only (`tintDepth`,
 * `tintColour`), as the host's layer draws them (`transmittanceDraws.ts`). Groups 0 and 1 are the
 * depth pass's (`layouts`); group 2 binds the GPU pages' views, pairs and arguments — and, into
 * the transmittance layer, the pool's opaque depth at binding 0. Compiled off the frame by
 * `prepare`, or at once by `made` (`preparedPipeline`).
 */
export function shadowFreshDraws(
  device: GPUDevice,
  module: GPUShaderModule,
  layouts: GPUBindGroupLayout[],
) {
  const poolLayout = device.createBindGroupLayout({ entries: freshEntries() });
  const tintLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
      ...freshEntries(),
    ],
  });
  const layoutOf = (group: GPUBindGroupLayout) =>
    device.createPipelineLayout({ bindGroupLayouts: [...layouts, group] });
  const pool = layoutOf(poolLayout),
    tint = layoutOf(tintLayout);
  const pipeline = (
    label: string,
    layout: GPUPipelineLayout,
    [vertex, fragment]: [string, string?],
    target: GPUColorTargetState | undefined,
    depthWriteEnabled: boolean,
    depthCompare: GPUCompareFunction,
    format: GPUTextureFormat,
  ) =>
    preparedPipeline(device, {
      label: `Trillion3D shadow GPU page ${label} v1`,
      layout,
      vertex: { module, entryPoint: vertex },
      ...(fragment && {
        fragment: { module, entryPoint: fragment, targets: target ? [target] : [] },
      }),
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format, depthWriteEnabled, depthCompare },
    });
  const colour = SHADOW_TRANSMITTANCE_FORMAT,
    tinted = SHADOW_TRANSLUCENT_DEPTH_FORMAT;
  const draws = {
    clear: pipeline(
      'clear',
      pool,
      ['shadow_fresh_clear_vs'],
      undefined,
      true,
      'always',
      'depth32float',
    ),
    casters: pipeline(
      'casters',
      pool,
      ['shadow_fresh_vs', 'shadow_fresh_fs'],
      undefined,
      true,
      DEPTH_COMPARE,
      'depth32float',
    ),
    tintClear: pipeline(
      'tint clear',
      tint,
      ['shadow_fresh_clear_vs', 'shadow_fresh_clear_fs'],
      { format: colour },
      true,
      'always',
      tinted,
    ),
    tintDepth: pipeline(
      'tint depth',
      tint,
      ['shadow_fresh_blend_vs', 'shadow_fresh_blend_fs'],
      { format: colour, writeMask: 0 },
      true,
      DEPTH_COMPARE,
      tinted,
    ),
    tintColour: pipeline(
      'tint colour',
      tint,
      ['shadow_fresh_blend_vs', 'shadow_fresh_blend_fs'],
      { format: colour, blend: TRANSMITTANCE_BLEND },
      false,
      'always',
      tinted,
    ),
  };
  type Made = { [K in keyof typeof draws]: GPURenderPipeline };
  let made: Made | undefined;
  return {
    /** Group 2 into the pool, and into the transmittance layer. */
    poolLayout,
    tintLayout,
    prepare: () => Promise.all(Object.values(draws).map((draw) => draw.prepare())),
    made: (): Made =>
      (made ??= Object.fromEntries(
        Object.entries(draws).map(([name, draw]) => [name, draw.get()]),
      ) as Made),
  };
}

export type ShadowFreshDraws = ReturnType<typeof shadowFreshDraws>;
