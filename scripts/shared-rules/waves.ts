// The wave model printed (\`../generate-shared-rules.ts\`): \`waveTerms\` into the GPU deformation's
// WGSL, \`waveRest\` and the wave's doubles into the physics module's C++ header.
import ts from 'typescript'
import { HEIGHT_ITERATIONS, waveRest } from '../../packages/sdk-core/src/fluids/waveRest.ts'
import { WAVE_FIELDS, waveTerms } from '../../packages/sdk-core/src/fluids/waves.ts'
import { comment, functionOf, header, statements } from './statements.ts'

const WAVES = 'packages/sdk-core/src/fluids/waves.ts'
const WAVE_REST = 'packages/sdk-core/src/fluids/waveRest.ts'

/** `waveTerms`, the statements of one wave's terms inside `deformWaves` (`deformWgsl.ts`): the
 *  wave's numbers are the WGSL names of its parameters, the point `p`, the sums `d` and `n`. */
export function waveTermsWgsl() {
  const { body: source, doc } = functionOf(WAVES, waveTerms.name)
  const terms: string[] = []
  const lines = statements(
    source.statements,
    {
      lang: 'wgsl',
      read: (node) =>
        ts.isIdentifier(node) && /^[xz]$/.test(node.text) ? `p.${node.text}` : undefined,
      write: (index, value) => void (terms[index] = value),
    },
    0,
  )
  if (terms.length !== 6 || terms.some((term) => term === undefined))
    throw new Error(`${WAVES}: waveTerms writes six terms`)
  lines.push(`d+=vec3f(${terms.slice(0, 3).join(',')});n-=vec3f(${terms.slice(3).join(',')});`)
  return `${header([`${WAVES} (\`waveTerms\`)`], '//')}

/**
${comment(doc, ' * ')}
 *
 * In WGSL: statements over the wave's numbers (\`dx\`, \`dz\`, \`k\`, \`amplitude\`, \`lateral\`,
 * \`phase\`) at the point \`p\`, adding the displacement to \`d\` and taking the normal's terms from
 * \`n\`.
 */
export const WAVE_TERMS = \`${lines.join('')}\`
`
}

/** The physics module's wave header: the constants, the wave's doubles and `waveRest`. */
export function waveModelHeader() {
  const { body: source, doc } = functionOf(WAVE_REST, waveRest.name)
  const fields = new Set<string>(WAVE_FIELDS)
  const lines = statements(
    source.statements,
    {
      lang: 'cpp',
      read(node) {
        if (ts.isPropertyAccessExpression(node) && node.getText() === 'waves.count') return 'count'
        if (
          ts.isElementAccessExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.expression.getText() === 'waves' &&
          fields.has(node.expression.name.text)
        )
          return `waves[${node.argumentExpression.getText()}].${node.expression.name.text}`
        return undefined
      },
      write: (index, value) => `${['restX', '', 'restZ'][index]} = ${value};`,
      counter: (bound) => (bound === 'count' ? 'uint32_t' : 'int'),
      pairs: new Map(),
    },
    1,
  )
  return `${header([WAVES, `${WAVE_REST} (\`waveRest\`)`], '//')}
#pragma once

#include <cstdint>

namespace trillion {

/// Newton iterations of the rest point (\`waveRest.ts\`).
constexpr int HEIGHT_ITERATIONS = ${HEIGHT_ITERATIONS};

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
