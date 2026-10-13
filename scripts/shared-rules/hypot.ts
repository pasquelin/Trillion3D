// `Math.hypot` of three numbers printed (`../generate-shared-rules.ts`): `largest` and `hypot3` of
// the maths core into the physics module's C++ header, so the water planes' normal is the length
// the page computes, operand for operand.
import ts from 'typescript'
import { expression, type Target } from './printer.ts'
import { functionOf } from './source.ts'
import { comment, header, statements } from './statements.ts'

const HYPOT = 'packages/math/src/float/hypot.ts'
const FUNCTIONS = ['largest', 'hypot3'] as const

/** C++'s names of what JavaScript names otherwise: its numbers, its maths and its comparisons. */
const cpp: Target = {
  lang: 'cpp',
  read(node) {
    if (ts.isIdentifier(node) && node.text === 'Infinity') return 'INFINITY'
    if (ts.isIdentifier(node) && node.text === 'NaN') return 'NAN'
    if (ts.isCallExpression(node) && /^Math\.(abs|sqrt)$/.test(node.expression.getText()))
      return `std::${node.expression.getText() === 'Math.abs' ? 'fabs' : 'sqrt'}(${expression(node.arguments[0], cpp)})`
    if (ts.isBinaryExpression(node) && /^[!=]==$/.test(node.operatorToken.getText()))
      return `${expression(node.left, cpp)} ${node.operatorToken.getText().slice(0, 2)} ${expression(node.right, cpp)}`
    return undefined
  },
}

/** The physics module's `hypot3` header: each function of `FUNCTIONS`, of doubles. */
export function hypotHeader() {
  const printed = FUNCTIONS.map((name) => {
    const { node, body, doc } = functionOf(HYPOT, name)
    const params = node.parameters.map((param) => `double ${param.name.getText()}`).join(', ')
    return `${comment(doc, '/// ')}
inline double ${name}(${params}) {
${statements(body.statements, cpp, 1).join('\n')}
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
