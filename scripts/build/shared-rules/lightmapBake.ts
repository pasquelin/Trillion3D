// The constants of the volumetric lightmap's bake, written once in TypeScript
// (`packages/sdk-core/src/contracts/lightmapBakeAbi.ts`) and printed into the compiler's Rust
// (`../generate-shared-rules.ts`): the job field, the settings' names, defaults and ranges.
import * as bake from '../../../packages/sdk-core/src/contracts/lightmapBakeAbi.ts'
import { header } from './statements.ts'

const snake = (name: string) => name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`).toUpperCase()

/** A Rust literal of a number: a float always has its point. */
const float = (value: number) => (Number.isInteger(value) ? value.toFixed(1) : String(value))

/** The bake's shared constants, `volumetric_lightmap/bake/abi.rs`. */
export function lightmapBakeAbiRust() {
  const rules = bake.LIGHTMAP_BAKE_RULES
  const lines = bake.LIGHTMAP_BAKE_SETTINGS.map((field) => {
    const rule = rules[field]
    const name = snake(field)
    const text = `pub const ${name}_SETTING: &str = ${JSON.stringify(field)};`
    if (rule.kind === 'flag') return `${text}\npub const DEFAULT_${name}: bool = ${rule.default};`
    const [low, high] = rule.range
    const type = rule.kind === 'int' ? 'u32' : 'f64'
    const show = rule.kind === 'int' ? String : float
    const high_ = high > 1e300 ? 'f64::MAX' : show(high)
    return [
      text,
      `pub const DEFAULT_${name}: ${type} = ${show(rule.default)};`,
      rule.kind === 'int'
        ? `pub const ${name}_RANGE: (u32, u32) = (${low}, ${high});`
        : `pub const ${name}_RANGE: (f64, f64) = (${show(low)}, ${high_});`,
    ].join('\n')
  })
  return `${header(['packages/sdk-core/src/contracts/lightmapBakeAbi.ts'], '//!')}

/// The job field naming the bake, the command line's flag holding it as JSON, the key of the
/// boxes the volume covers and the product holding the baked lightmap.
pub const LIGHTMAP_BAKE_FIELD: &str = ${JSON.stringify(bake.LIGHTMAP_BAKE_FIELD)};
pub const LIGHTMAP_BAKE_OPTION: &str = ${JSON.stringify(bake.LIGHTMAP_BAKE_OPTION)};
pub const LIGHTMAP_BAKE_VOLUMES: &str = ${JSON.stringify(bake.LIGHTMAP_BAKE_VOLUMES)};
pub const LIGHTMAP_BAKE_FILE: &str = ${JSON.stringify(bake.LIGHTMAP_BAKE_FILE)};
/// The reference's length unit per metre.
pub const LIGHTMAP_BAKE_UNITS_PER_METRE: f64 = ${float(bake.LIGHTMAP_BAKE_UNITS_PER_METRE)};
/// The settings' names, defaults and ranges, the reference's.
pub const LIGHTMAP_BAKE_SETTINGS: [&str; ${bake.LIGHTMAP_BAKE_SETTINGS.length}] = [${bake.LIGHTMAP_BAKE_SETTINGS.map((f) => JSON.stringify(f)).join(', ')}];
${lines.join('\n')}
`
}
