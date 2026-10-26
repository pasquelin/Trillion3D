// The constants of the volumetric lightmap's bake, written once in TypeScript
// (`packages/sdk-core/src/contracts/lightmapBakeAbi.ts`) and printed into the compiler's Rust
// (`../generate-shared-rules.ts`): the job field, the settings' names, defaults and ranges.
import * as bake from '../../../packages/sdk-core/src/contracts/lightmapBakeAbi.ts'
import { float, header, rustStrings } from './statements.ts'

const snake = (name: string) => name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`).toUpperCase()

/** The Rust constant of the range `rule` takes, `<name>_RANGE`: the widest finite numbers as the
 *  type's own bounds. */
const rangeLine = (name: string, rule: { kind: string; range: readonly [number, number] }) => {
  const [low, high] = rule.range
  if (rule.kind === 'int') return `pub const ${name}_RANGE: (u32, u32) = (${low}, ${high});`
  const low_ = low < -1e300 ? 'f64::MIN' : float(low)
  const high_ = high > 1e300 ? 'f64::MAX' : float(high)
  return `pub const ${name}_RANGE: (f64, f64) = (${low_}, ${high_});`
}

/** The bake's shared constants, `volumetric_lightmap/bake/abi.rs`. */
export function lightmapBakeAbiRust() {
  const rules = bake.LIGHTMAP_BAKE_RULES
  const lines = bake.LIGHTMAP_BAKE_SETTINGS.map((field) => {
    const rule = rules[field]
    const name = snake(field)
    const text = `pub const ${name}_SETTING: &str = ${JSON.stringify(field)};`
    if (rule.kind === 'flag') return `${text}\npub const DEFAULT_${name}: bool = ${rule.default};`
    const type = rule.kind === 'int' ? 'u32' : 'f64'
    const show = rule.kind === 'int' ? String : float
    return [
      text,
      `pub const DEFAULT_${name}: ${type} = ${show(rule.default)};`,
      rangeLine(name, rule),
    ].join('\n')
  })
  const skyRules = bake.LIGHTMAP_BAKE_SKY_RULES
  const skyLines = bake.LIGHTMAP_BAKE_SKY_SETTINGS.map((field) => {
    const rule = skyRules[field]
    const name = `SKY_LIGHT_${snake(field)}`
    const text = `pub const ${name}_SETTING: &str = ${JSON.stringify(field)};`
    if (rule.kind === 'flag') return `${text}\npub const DEFAULT_${name}: bool = ${rule.default};`
    if (rule.kind === 'vector')
      return `${text}\npub const DEFAULT_${name}: [f64; ${rule.default.length}] = [${rule.default.map(float).join(', ')}];`
    return `${text}\npub const DEFAULT_${name}: f64 = ${float(rule.default)};\n${rangeLine(name, rule)}`
  })
  return `${header(['packages/sdk-core/src/contracts/lightmapBakeAbi.ts'], '//!')}

/// The job field naming the bake, the command line's flag holding it as JSON, the keys of the
/// boxes the volume covers and of the sky light, and the product holding the baked lightmap.
pub const LIGHTMAP_BAKE_FIELD: &str = ${JSON.stringify(bake.LIGHTMAP_BAKE_FIELD)};
pub const LIGHTMAP_BAKE_OPTION: &str = ${JSON.stringify(bake.LIGHTMAP_BAKE_OPTION)};
pub const LIGHTMAP_BAKE_VOLUMES: &str = ${JSON.stringify(bake.LIGHTMAP_BAKE_VOLUMES)};
pub const LIGHTMAP_BAKE_SKY: &str = ${JSON.stringify(bake.LIGHTMAP_BAKE_SKY)};
pub const LIGHTMAP_BAKE_FILE: &str = ${JSON.stringify(bake.LIGHTMAP_BAKE_FILE)};
/// The reference's length unit per metre.
pub const LIGHTMAP_BAKE_UNITS_PER_METRE: f64 = ${float(bake.LIGHTMAP_BAKE_UNITS_PER_METRE)};
/// The settings' names, defaults and ranges, the reference's.
pub const LIGHTMAP_BAKE_SETTINGS: ${rustStrings(bake.LIGHTMAP_BAKE_SETTINGS)};
${lines.join('\n')}
/// The sky light the bake shines (\`skyLight\`): its settings' names and defaults, the sky light part's own.
pub const LIGHTMAP_BAKE_SKY_SETTINGS: ${rustStrings(bake.LIGHTMAP_BAKE_SKY_SETTINGS)};
${skyLines.join('\n')}
`
}
