// `Math.hypot` of three numbers printed (`../generate-shared-rules.ts`): `largest` and `hypot3` of
// the maths core into the physics module's C++ header, so the water planes' normal is the length
// the page computes, operand for operand.
import { functionOf } from './source.ts'
import { comment, header, statements } from './statements.ts'

const HYPOT = 'packages/math/src/float/hypot.ts'
const FUNCTIONS = ['largest', 'hypot3'] as const

/** The physics module's `hypot3` header: each function of `FUNCTIONS`, of doubles. */
export function hypotHeader() {
  const printed = FUNCTIONS.map((name) => {
    const { node, body, doc } = functionOf(HYPOT, name)
    const params = node.parameters.map((param) => `double ${param.name.getText()}`).join(', ')
    return `${comment(doc, '/// ')}
inline double ${name}(${params}) {
${statements(body.statements, { lang: 'cpp' }, 1).join('\n')}
}`
  })
  return `${header([`${HYPOT} (${FUNCTIONS.map((name) => `\`${name}\``).join(', ')})`], '//')}
#pragma once

#include <cmath>

namespace trillion {

${printed.join('\n\n')}

}  // namespace trillion
`
}
