// The finishing's uniform as the shader's `finish`, for the finishing functions the shipped text
// runs in doubles (`shaderRun`): `compositions.test.ts` (the local exposure) and `film.test.ts`.
import {
  EXPOSURE_MIDDLE_GREY,
  EXPOSURE_RULES,
  type ExposureValues,
} from '../../../../sdk-core/src/contracts/exposureOptions.ts'
import {
  FILM_RULES,
  type FilmSettings,
  type FilmValues,
} from '../../../../sdk-core/src/contracts/filmOptions.ts'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { wgslSource } from '../../../../math/src/wgsl/source.fixture.ts'
import { CONTRACT_COMPOSITIONS } from '../../lighting/deferred/shaders.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { grainOn } from './filmParams.ts'
import { FINISH } from './finishLayout.ts'
import { lensOf, writeFinishParams, type FinishInput } from './finishParams.ts'

/** The words of the finishing's uniform for exposure settings `options` over the defaults and the
 *  inputs `input` over a 1920 × 1080 image with the default film: each field of `FINISH` its four
 *  words. The log2 of the middle grey the local exposure pulls toward, which the GPU copies from the
 *  exposure buffer, is `grey`: that of the bias and the local bias by default. */
export function finishScope(
  options: Partial<ExposureValues>,
  input: Partial<FinishInput> = {},
  grey?: number,
) {
  const settings = { ...resolveSettings(EXPOSURE_RULES, {}), ...options } as ExposureValues
  const film: FilmValues = input.film ?? resolveSettings(FILM_RULES, {})
  const words = new Float32Array(FINISH.words)
  writeFinishParams(words, {
    settings,
    film,
    vignette: 0.4,
    lens: lensOf(null),
    local: true,
    glow: false,
    size: [1920, 1080],
    grain: grainOn(film),
    frame: 0,
    ...input,
  })
  words[FINISH.at.base] =
    grey ??
    Math.log2(
      EXPOSURE_MIDDLE_GREY * 2 ** (settings.exposureBias + settings.localExposureMiddleGreyBias),
    )
  const field = (at: number) => [...words.subarray(at, at + 4)]
  const finish = Object.fromEntries(
    Object.entries(FINISH.at).map(([name, at]) => [name, field(at)]),
  )
  return { finish, words, settings }
}

/** The shipped finishing functions `names`, run over the words the film settings `film` write on
 *  a 1000 × 1000 image. */
export function filmRun<T>(
  film: FilmSettings,
  names: string[],
  scope = {},
  input: Partial<FinishInput> = {},
) {
  const resolved = resolveSettings(FILM_RULES, film)
  const { finish } = finishScope({}, { size: [1000, 1000], film: resolved, ...input })
  return {
    ...shaderRun<T>(CONTRACT_COMPOSITIONS.finish.flagless, names, { finish, ...scope }),
    finish,
  }
}

/** The three luminance weights of the grain's zones, read from the shipped finishing text. */
export const grainLuma = () =>
  /const GRAIN_LUMA=vec3f\(([^)]*)\);/
    .exec(wgslSource(CONTRACT_COMPOSITIONS.finish.flagless))![1]
    .split(',')
    .map(Number)
