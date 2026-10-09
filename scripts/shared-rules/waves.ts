// The wave model printed (`../generate-shared-rules.ts`): `waveTerms` into the GPU deformation's
// WGSL, `waveRest` with `waveTerms` inlined, the constants it reads and the wave's doubles into the
// physics module's C++ header.
import ts from 'typescript'
import { waveRest } from '../../packages/sdk-core/src/fluids/waveRest.ts'
import { TERM_SLOTS, WAVE_FIELDS, waveTerms } from '../../packages/sdk-core/src/fluids/waves.ts'
import { withInlined } from './inline.ts'
import { constantsOf, functionOf, readConstants } from './source.ts'
import { comment, header, statements } from './statements.ts'

const WAVES = 'packages/sdk-core/src/fluids/waves.ts'
const WAVE_REST = 'packages/sdk-core/src/fluids/waveRest.ts'

/** The field of `waves.<field>[index]`, a wave's number, and its index; `undefined` for any other
 *  expression. */
function waveField(node: ts.Expression) {
  if (
    !ts.isElementAccessExpression(node) ||
    !ts.isPropertyAccessExpression(node.expression) ||
    node.expression.expression.getText() !== 'waves'
  )
    return undefined
  const field = WAVE_FIELDS.indexOf(node.expression.name.text as (typeof WAVE_FIELDS)[number])
  if (field < 0) return undefined
  return { field, index: node.argumentExpression.getText() }
}

/** `waveTerms`, the statements of one wave's terms inside `deformWaves` (`deformWgsl.ts`): the
 *  wave's numbers are its floats in `positions` from `b`, in `WAVE_FIELDS` order, the point `p`,
 *  the sums `d` and `n`. */
export function waveTermsWgsl() {
  const { body: source, doc } = functionOf(WAVES, waveTerms.name)
  const terms: string[] = []
  const lines = statements(
    source.statements,
    {
      lang: 'wgsl',
      constants: constantsOf(WAVES),
      read(node) {
        if (ts.isIdentifier(node) && /^[xz]$/.test(node.text)) return `p.${node.text}`
        const wave = waveField(node)
        if (!wave) return undefined
        if (wave.index !== 'i') throw new Error(`${WAVES}: waveTerms reads wave 'i' alone`)
        return wave.field ? `positions[b+${wave.field}u]` : 'positions[b]'
      },
      write: (index, value) => void (terms[index] = value),
    },
    0,
  )
  const { offset, normal } = TERM_SLOTS
  const slots: readonly number[] = [...offset, ...normal]
  if (terms.length !== slots.length || slots.some((slot) => terms[slot] === undefined))
    throw new Error(`${WAVES}: waveTerms writes each of its TERM_SLOTS`)
  const sum = (group: readonly number[]) => group.map((slot) => terms[slot]).join(',')
  lines.push(`d+=vec3f(${sum(offset)});n-=vec3f(${sum(normal)});`)
  return `${header([`${WAVES} (\`waveTerms\`)`], '//')}

/**
${comment(doc, ' * ')}
 *
 * In WGSL: statements over wave \`i\`'s floats in \`positions\` from \`b\`, in \`WAVE_FIELDS\` order,
 * at the point \`p\`, adding the displacement to \`d\` and taking the normal's terms from \`n\`.
 */
export const WAVE_TERMS = \`${lines.join('')}\`
`
}

/** The physics module's wave header: the constants, the wave's doubles and `waveRest`, `waveTerms`
 *  inlined in it. */
export function waveModelHeader() {
  const { body: source, doc } = functionOf(WAVE_REST, waveRest.name)
  const constants = readConstants(source, constantsOf(WAVE_REST))
  const target = withInlined(
    {
      lang: 'cpp',
      read(node) {
        if (ts.isPropertyAccessExpression(node) && node.getText() === 'waves.count') return 'count'
        const wave = waveField(node)
        return wave && `waves[${wave.index}].${WAVE_FIELDS[wave.field]}`
      },
      write: (index, value) => `rest${'XYZ'[index]} = ${value};`,
      counter: (bound) => (bound === 'count' ? 'uint32_t' : 'int'),
      pairs: new Map(),
    },
    WAVES,
    waveTerms.name,
  )
  const lines = statements(source.statements, target, 1)
  const constexprs = constants.map(
    ([name, { value, doc: constantDoc }]) =>
      `${comment(constantDoc, '/// ')}
constexpr ${/^\d+$/.test(value) ? 'int' : 'double'} ${name} = ${value};`,
  )
  return `${header([`${WAVES} (\`waveTerms\`)`, `${WAVE_REST} (\`waveRest\`)`], '//')}
#pragma once

#include <cstdint>

namespace trillion {

${constexprs.join('\n\n')}

/// One wave as \`jolt_wave_buffer\` takes it (\`waves.ts\` WAVE_FIELDS).
struct Wave {
  double ${WAVE_FIELDS.join(', ')};
};
/// Doubles of one wave.
constexpr uint32_t WAVE_DOUBLES = ${WAVE_FIELDS.length};

/// \`sin\` and \`cos\` of \`x\` (\`waterPlanes.cpp\`).
void sinCos(double x, double &s, double &c);

${comment(doc, '/// ')}
inline void waveRest(const Wave *waves, uint32_t count, double x, double z, double &restX,
                     double &restZ) {
${lines.join('\n')}
}

}  // namespace trillion
`
}
