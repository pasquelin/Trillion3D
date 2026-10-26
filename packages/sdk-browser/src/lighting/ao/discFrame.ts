import type { AmbientOcclusionSettings } from '../../../../sdk-core/src/contracts/ambientOcclusionOptions.ts'
import { AMBIENT_OCCLUSION_PASS } from '../../diagnostic/stage/passLabels.ts'
import { writeChanged } from '../../gpu/core/writeChanged.ts'
import { fullscreenDraw } from '../../post/filters/fullscreenDraw.ts'
import { AO_BINDINGS, AO_PARAMS, AO_PARAMS_BYTES } from './layout.ts'
import { aoCommonEntries, specCache, type AoMethod, type AoNeeded } from './method.ts'
import { aoShapeOf, type AoShape } from './occlusionWgsl.ts'
import { createDepthTerms, writeAoParams, type AoImage } from './params.ts'
import { aoPasses, aoTargetExtent, aoTargetRect, AO_TARGETS, type AoPass } from './plan.ts'
import { aoPrograms } from './pipelines.ts'
import type { AoView, AoViewSpec } from './view.ts'

/** The groups of a view's passes, made over the depth, the normals and the stand-in this image reads, and kept for the
 *  resources the view has met (`AoView.identity`). A step reads the setup of its own resolution, the last pass the setup of
 *  the half and the coarser result; a pass that reads none of them is bound to a stand-in. */
function groupsOf(
  view: AoView,
  programs: ReturnType<typeof aoPrograms>,
  passes: readonly AoPass[],
  needed: AoNeeded,
) {
  const { identity } = view
  identity.next[0] = needed.depth
  identity.next[1] = needed.normals
  identity.next[2] = needed.empty
  if (identity.moved())
    view.groups[identity.slot] = passes.map((pass, at) =>
      needed.device.createBindGroup({
        label: `${AMBIENT_OCCLUSION_PASS} ${pass.target}`,
        layout: programs.layout,
        entries: [
          ...aoCommonEntries(view.params[at], needed),
          {
            binding: AO_BINDINGS.setup,
            resource: pass.setup ? view.textures[pass.setup] : programs.emptySetup,
          },
          {
            binding: AO_BINDINGS.lower,
            resource: pass.lower ? view.textures[pass.lower] : needed.empty,
          },
        ],
      }),
    )
  return view.groups[identity.slot]
}

/** What a method refills for each pass instead of making it: the draw's descriptor, the uniform's words (and the same as the
 *  integers `writeChanged` compares) and the rectangle drawn — one set for each view's method, shared with no other. */
function createScratch() {
  const words = new Float32Array(AO_PARAMS.words)
  return {
    draw: fullscreenDraw(AMBIENT_OCCLUSION_PASS),
    words,
    sent: new Uint32Array(words.buffer),
    rect: [0, 0],
    terms: createDepthTerms(),
  }
}

/** The program a pass is drawn with: its search's, or the smoothing's or the setup's. */
const programOf = (
  programs: ReturnType<typeof aoPrograms>,
  shape: AoShape | undefined,
  pass: AoPass,
) => (shape ? programs.search(shape) : pass.kind === 'smooth' ? programs.smooth : programs.setup)

/** The plan of one image: its passes and the program shape of each search among them (none for a setup or the smoothing). */
interface DiscPlan {
  passes: readonly AoPass[]
  shapes: readonly (AoShape | undefined)[]
}

/** The plan of the settings' resolutions, with the smoothing pass where `smooth`: the passes and the program shape of each
 *  search among them. */
function planOf(settings: AmbientOcclusionSettings, smooth: boolean): DiscPlan {
  const passes = aoPasses(settings.levels, smooth)
  return {
    passes,
    shapes: passes.map((pass) =>
      pass.kind === 'setup' || pass.kind === 'smooth'
        ? undefined
        : aoShapeOf(pass.kind, settings.shaderQuality, !!pass.lower, settings.compute),
    ),
  }
}

/** What a view of `plan` holds at the textures' `extent`: a texture and a uniform for each pass. */
const specOf = ({ passes }: DiscPlan, extent: readonly [number, number]): AoViewSpec => ({
  textures: passes.map(({ target }) => ({
    name: target,
    size: aoTargetExtent(target, extent),
    format: AO_TARGETS[target].format,
  })),
  passes: passes.length,
  paramBytes: AO_PARAMS_BYTES,
})

/** The passes of `plan` drawn over the view's textures, each from its own uniform — the words that moved go up — and each
 *  reading the one before; the texture the lighting reads. */
function drawPlan(
  { passes, shapes }: DiscPlan,
  scratch: ReturnType<typeof createScratch>,
  settings: AmbientOcclusionSettings,
  encoder: GPUCommandEncoder,
  view: AoView,
  needed: AoNeeded,
  image: AoImage,
) {
  const { draw, words, sent, rect, terms } = scratch
  const programs = aoPrograms(needed.device)
  const groups = groupsOf(view, programs, passes, needed)
  for (let at = 0; at < passes.length; at++) {
    const pass = passes[at]
    writeAoParams(words, pass, settings, image, terms)
    writeChanged(needed.device, view.params[at], sent, 0, AO_PARAMS.words)
    draw(
      encoder,
      view.textures[pass.target],
      programOf(programs, shapes[at], pass).get(),
      groups[at],
      undefined,
      aoTargetRect(pass.target, image.view, rect),
    )
  }
  return view.textures.ao
}

/**
 * THE DISC SEARCH (`ambientOcclusionMethod: 'disc'`), the default: the passes of the settings' resolutions (`aoPasses`) and
 * the program shape of each search among them (none for a setup or the smoothing), made once while the settings hold — and
 * the same with the smoothing pass, for an image that does not accumulate in time (the compute pass's).
 */
export function discMethod(settings: AmbientOcclusionSettings): AoMethod {
  const plain = planOf(settings, false)
  const smoothed = settings.compute && settings.computeSmooth ? planOf(settings, true) : plain
  const chosen = (accumulates: boolean) => (accumulates ? plain : smoothed)
  const plans = smoothed === plain ? [plain] : [plain, smoothed]
  const scratch = createScratch()
  const cache = specCache((extent, accumulates) => specOf(chosen(accumulates), extent))
  return {
    spec: cache.spec,
    get extent() {
      return cache.extent
    },
    ready(device) {
      const programs = aoPrograms(device)
      let ready = true
      for (const { passes, shapes } of plans)
        for (let at = 0; at < passes.length; at++)
          ready = programOf(programs, shapes[at], passes[at]).ask().ready && ready
      return ready
    },
    draw: (encoder, view, needed, image) =>
      drawPlan(chosen(image.accumulates), scratch, settings, encoder, view, needed, image),
  }
}
