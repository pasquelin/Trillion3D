// The finishing's uniform as the shader's `finish`, for the finishing functions the shipped text
// runs in doubles (`shaderRun`): `compositions.test.ts` (the local exposure) and `film.test.ts`.
import { EXPOSURE_RULES } from '../../../../sdk-core/src/contracts/exposureOptions.ts'
import {
  FILM_RULES,
  type FilmSettings,
  type FilmValues,
} from '../../../../sdk-core/src/contracts/filmOptions.ts'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { CONTRACT_COMPOSITIONS } from '../../lighting/deferred/shaders.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import type { ExposureSettings } from '../exposure/meterParams.ts'
import { grainOn } from './filmParams.ts'
import { FINISH } from './finishLayout.ts'
import { writeFinishParams, type FinishInput } from './finishParams.ts'

/** The words of the finishing's uniform for exposure settings `options` over the defaults and the
 *  inputs `input` over a 1920 × 1080 image with the default film: each field of `FINISH` its four
 *  words. */
export function finishScope(options: Partial<ExposureSettings>, input: Partial<FinishInput> = {}) {
  const settings = { ...resolveSettings(EXPOSURE_RULES, {}), ...options } as ExposureSettings
  const film: FilmValues = input.film ?? resolveSettings(FILM_RULES, {})
  const words = new Float32Array(FINISH.words)
  writeFinishParams(words, {
    settings,
    film,
    vignette: 0.4,
    auto: true,
    local: true,
    glow: false,
    size: [1920, 1080],
    grain: grainOn(film),
    frame: 0,
    ...input,
  })
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
    ...shaderRun<T>(CONTRACT_COMPOSITIONS.finish.accumulated, names, { finish, ...scope }),
    finish,
  }
}
