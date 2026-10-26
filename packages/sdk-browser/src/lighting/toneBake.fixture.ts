// The tone table's baking run in JavaScript (`shaderRun`): the shipped WGSL over the words the
// settings write (`toneBakeParams.ts`), as `finishScope.fixture.ts` does for the finishing.
import {
  COLOR_GRADING_RULES,
  type ColorGradingSettings,
} from '../../../sdk-core/src/contracts/colorGradingOptions.ts'
import { resolveSettings } from '../../../sdk-core/src/contracts/settingRules.ts'
import { shaderRun } from '../materials/texture/shaderRun.fixture.ts'
import { toneBakeShader, BAKE_LAYOUT } from './toneBakeWgsl.ts'
import { writeBake } from './toneBakeParams.ts'

type V3 = number[]
type Bake = ReturnType<typeof bakeOf>
/** The baking's functions as the shader declares them, the uniform their first argument. */
type BakeShader = {
  tableColor: (bake: Bake, code: V3) => V3
  displayLight: (bake: Bake, light: V3) => V3
  shaperLight: (code: V3, shaper: number) => V3
  shaperCode: (light: V3, shaper: number) => V3
  colorCorrectAll: (bake: Bake, light: V3) => V3
}

/** The uniform's members, read from the words `writeBake` wrote (`BAKE_LAYOUT`). */
function bakeOf(words: Float32Array) {
  const { at } = BAKE_LAYOUT
  const vec4 = (word: number) => [...words.subarray(word, word + 4)]
  return {
    wb: [0, 1, 2].map((column) => vec4(at.wb + 4 * column)),
    film: { curve: vec4(at.film), scales: vec4(at.film + 4), blend: vec4(at.film + 8) },
    grade: Array.from({ length: 20 }, (_, i) => vec4(at.grade + 4 * i)),
    bounds: vec4(at.bounds),
    mapping: vec4(at.mapping),
    device: vec4(at.device),
    lattice: vec4(at.lattice),
    aces: vec4(at.aces),
  }
}

/** The baking of the colour settings `settings` (over the defaults) for the display curve of rank
 *  `rank`, run as JavaScript: the colour of a texel's code (`tableColor`), the colour of a light
 *  (`displayLight`), the light a code stands for and the code of a light (`shaperLight`,
 *  `shaperCode`, with the shaper 0 or 1), and the grade of a light (`colorCorrectAll`); `words` are
 *  the uniform's, `bake` its members. */
export function bakeRun(settings: ColorGradingSettings, rank: number) {
  const words = new Float32Array(BAKE_LAYOUT.words)
  writeBake(words, resolveSettings(COLOR_GRADING_RULES, settings), rank)
  const bake = bakeOf(words)
  const run = shaderRun<BakeShader>(
    toneBakeShader('rgba16float'),
    ['tableColor', 'displayLight', 'shaperLight', 'shaperCode', 'colorCorrectAll'],
    { bake },
  )
  return {
    tableColor: (code: V3) => run.tableColor(bake, code),
    displayLight: (light: V3) => run.displayLight(bake, light),
    colorCorrectAll: (light: V3) => run.colorCorrectAll(bake, light),
    shaperLight: run.shaperLight,
    shaperCode: run.shaperCode,
    words,
    bake,
  }
}
