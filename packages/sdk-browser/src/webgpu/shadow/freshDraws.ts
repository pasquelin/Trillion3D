import { DEPTH_COMPARE } from '../../camera/depthConvention.ts';
import { casterPrimitive } from '../../gpu/shadow/casterPrimitive.ts';
import { preparedPipeline } from '../../lighting/deferred/fullscreen.ts';
import { VIS_BINDINGS } from '../core/bindLayout.ts';
import { visLayoutEntries } from '../visibility/shaders.ts';
import { staticLayerEntries } from '../../gpu/shadow/staticLayer.ts';
import {
  SHADOW_TRANSLUCENT_DEPTH_FORMAT,
  SHADOW_TRANSMITTANCE_FORMAT,
  TRANSMITTANCE_BLEND,
} from '../../gpu/shadow/transmittance.ts';

/** Group 0's entries the GPU pages' draws never read: the raster's Hi-Z flags and slot lists. A
 *  vertex stage then reads four storage buffers there, seven with group 2's: within the eight any
 *  device holds. */
export const FRESH_UNREAD = new Set([
  VIS_BINDINGS.flags,
  VIS_BINDINGS.instances,
  VIS_BINDINGS.slotOffsets,
]);

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
 * `tintColour`), as the host's layer draws them (`transmittanceDraws.ts`). Group 0 is the depth
 * pass's, but for what these draws never read (`FRESH_UNREAD`), group 1 its faces'; group 2 binds the GPU
 * pages' views, pairs and arguments — and, into the transmittance layer, the pool's opaque depth
 * at binding 0. Compiled off the frame by
 * `prepare`, or at once by `made` (`preparedPipeline`). With a static layer (#831): into it, the
 * same clear, then the still casters alone (`staticCasters`); into the pool, its pages restored
 * from it (`restore`), then the moving casters alone (`movingCasters`).
 */
export function shadowFreshDraws(
  device: GPUDevice,
  module: GPUShaderModule,
  faceLayout: GPUBindGroupLayout,
) {
  const pageLayout = device.createBindGroupLayout({
    entries: visLayoutEntries().filter((entry) => !FRESH_UNREAD.has(entry.binding)),
  });
  const poolLayout = device.createBindGroupLayout({ entries: freshEntries() });
  const tintLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
      ...freshEntries(),
    ],
  });
  const layoutOf = (...groups: GPUBindGroupLayout[]) =>
    device.createPipelineLayout({ bindGroupLayouts: [pageLayout, faceLayout, ...groups] });
  const pool = layoutOf(poolLayout),
    tint = layoutOf(tintLayout),
    // The static layer's own layout at group 3: its groups bind there as they are.
    restored = layoutOf(
      poolLayout,
      device.createBindGroupLayout({ entries: staticLayerEntries() }),
    );
  // The clear draws place page squares in NDC; the caster draws place sun corners through
  // `shadowVertexIn` -> `sunSnap` (`freshDrawsWgsl.ts`), which the hardware clipper can cut into
  // unsnapped corners (#26). `casterPrimitive` disables that clip where the device allows it; the
  // clears keep the default.
  const base: GPUPrimitiveState = { topology: 'triangle-list', cullMode: 'none' };
  const caster = casterPrimitive(device, base);
  const pipeline = (
    label: string,
    layout: GPUPipelineLayout,
    [vertex, fragment]: [string, string?],
    target: GPUColorTargetState | undefined,
    depthWriteEnabled: boolean,
    depthCompare: GPUCompareFunction,
    format: GPUTextureFormat,
    primitive: GPUPrimitiveState,
  ) =>
    preparedPipeline(device, {
      label: `Trillion3D shadow GPU page ${label} v1`,
      layout,
      vertex: { module, entryPoint: vertex },
      ...(fragment && {
        fragment: { module, entryPoint: fragment, targets: target ? [target] : [] },
      }),
      primitive,
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
      base,
    ),
    casters: pipeline(
      'casters',
      pool,
      ['shadow_fresh_vs', 'shadow_fresh_fs'],
      undefined,
      true,
      DEPTH_COMPARE,
      'depth32float',
      caster,
    ),
    staticCasters: pipeline(
      'static casters',
      pool,
      ['shadow_fresh_static_vs', 'shadow_fresh_fs'],
      undefined,
      true,
      DEPTH_COMPARE,
      'depth32float',
      caster,
    ),
    restore: pipeline(
      'restore',
      restored,
      ['shadow_fresh_clear_vs', 'shadow_fresh_restore_fs'],
      undefined,
      true,
      'always',
      'depth32float',
      base,
    ),
    movingCasters: pipeline(
      'moving casters',
      pool,
      ['shadow_fresh_moving_vs', 'shadow_fresh_fs'],
      undefined,
      true,
      DEPTH_COMPARE,
      'depth32float',
      caster,
    ),
    tintClear: pipeline(
      'tint clear',
      tint,
      ['shadow_fresh_clear_vs', 'shadow_fresh_clear_fs'],
      { format: colour },
      true,
      'always',
      tinted,
      base,
    ),
    tintDepth: pipeline(
      'tint depth',
      tint,
      ['shadow_fresh_blend_vs', 'shadow_fresh_blend_fs'],
      { format: colour, writeMask: 0 },
      true,
      DEPTH_COMPARE,
      tinted,
      caster,
    ),
    tintColour: pipeline(
      'tint colour',
      tint,
      ['shadow_fresh_blend_vs', 'shadow_fresh_blend_fs'],
      { format: colour, blend: TRANSMITTANCE_BLEND },
      false,
      'always',
      tinted,
      caster,
    ),
  };
  type Made = { [K in keyof typeof draws]: GPURenderPipeline };
  let made: Made | undefined;
  return {
    /** Group 0, then group 2 into the pool, and into the transmittance layer. */
    pageLayout,
    poolLayout,
    tintLayout,
    prepare: () => Promise.all(Object.values(draws).map((draw) => draw.prepare())),
    made: (): Made =>
      (made ??= Object.fromEntries(
        Object.entries(draws).map(([name, draw]) => [name, draw.get()]),
      ) as Made),
  };
}
