import {
  COLOR_GRADING_RULES,
  type ColorGradingValues,
} from '../../../../sdk-core/src/contracts/colorGradingOptions.ts'
import { FILM_RULES, type FilmValues } from '../../../../sdk-core/src/contracts/filmOptions.ts'
import { resolveSettingsStamped } from '../../../../sdk-core/src/contracts/settingRules.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'

/** The film settings of the view, read again by each call into one object. */
const resolvedFilm = {} as FilmValues
/** The colour settings of the view, read again by each call into one object. */
const resolvedColor = {} as ColorGradingValues

/** The film effects' settings (`FILM_RULES`), resolved from the view's context: the one place they
 *  are read by the frame — the finishing, and the pre-exposure that reads the scene's tint. The
 *  object is the same at each call. */
export const filmSettings = (rt: Pick<WebgpuPagesRuntime, 'context'>) =>
  resolveSettingsStamped(FILM_RULES, rt.context, resolvedFilm)

/** The colour settings (`COLOR_GRADING_RULES`), resolved from the view's context: the one place
 *  they are read by the frame, by the tone table's baking. The object is the same at each call. */
export const colorGradingSettings = (rt: Pick<WebgpuPagesRuntime, 'context'>) =>
  resolveSettingsStamped(COLOR_GRADING_RULES, rt.context, resolvedColor)
