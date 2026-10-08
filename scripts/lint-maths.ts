// The inline forms of a formula `packages/math` holds, refused by the lint everywhere but in the
// maths themselves and in the declared oracles (`eslint.config.ts`): each is one AST selector of
// `no-restricted-syntax`, its message naming the function or constant to call instead
// (`docs/MATHS.md`). `scripts/lint-maths.test.ts` plants each form and lints it through the config.
import { matchesGlob } from 'node:path'

/** A call of `Math.<name>`. */
const math = (name: string) =>
  `[callee.type='MemberExpression'][callee.object.name='Math'][callee.property.name='${name}']`
/** `Math.PI` itself. */
const PI = "MemberExpression[object.name='Math'][property.name='PI']"
/** A product or a quotient. */
const PRODUCT = ":matches(BinaryExpression[operator='*'], BinaryExpression[operator='/'])"
/** A loop over sixteen indices, `for (…; i < 16; …)`. */
const SIXTEEN = "ForStatement[test.operator='<'][test.right.value=16]"
/** One element copied from an array to another, `out[…] = m[…]`. */
const COPY =
  "AssignmentExpression[operator='='][left.type='MemberExpression'][left.computed=true][right.type='MemberExpression'][right.computed=true]"

const fraction =
  'is a fraction of π the maths hold: `HALF_PI`, `QUARTER_PI`, `TAU`, `DEG2RAD`, `RAD2DEG` ' +
  '(`packages/math/src/constants.ts`) or the function of the angle (`perspectiveSlope`)'

/** The `no-restricted-syntax` entries of the maths' inline forms. */
export const MATHS_FORMS = [
  {
    selector: `CallExpression${math('ceil')} > BinaryExpression.arguments[operator='/']`,
    message: '`Math.ceil(a / b)` is `ceilDiv(a, b)` (`packages/math/src/scalar/integers.ts`).',
  },
  {
    selector: `CallExpression${math('min')}[arguments.length=2] > CallExpression.arguments${math('max')}[arguments.length=2]`,
    message:
      'A clamp written with `Math.min` and `Math.max` is `clamp` (`packages/math/src/scalar/reals.ts`).',
  },
  {
    selector: `CallExpression${math('max')}[arguments.length=2] > CallExpression.arguments${math('min')}[arguments.length=2]`,
    message:
      'A clamp written with `Math.max` and `Math.min` is `clampLowWins` (`packages/math/src/scalar/reals.ts`).',
  },
  {
    selector: "MemberExpression[object.name='Math'][property.name='hypot']",
    message:
      'A length is `length2`/`length3` (`packages/math/src/vector/vector.ts`); `hypot2`/`hypot3`/`hypot4` where `docs/MATHS.md` "Lengths" declares it.',
  },
  {
    selector: `${SIXTEEN} > ExpressionStatement.body > ${COPY}`,
    message:
      'A sixteen-element copy loop is `copyMatrix4` (`packages/math/src/matrix/matrix4.ts`).',
  },
  {
    selector: `${SIXTEEN} > BlockStatement.body[body.length=1] > ExpressionStatement > ${COPY}`,
    message:
      'A sixteen-element copy loop is `copyMatrix4` (`packages/math/src/matrix/matrix4.ts`).',
  },
  {
    selector: `${PRODUCT}[left.type='Literal'] > ${PI}.right`,
    message: `\`n * Math.PI\` ${fraction}.`,
  },
  {
    selector: `${PRODUCT}[right.type='Literal'] > ${PI}.left`,
    message: `\`Math.PI / n\` ${fraction}.`,
  },
  {
    selector: `${PRODUCT}[right.type='Literal'] > BinaryExpression.left[operator='*'] > ${PI}`,
    message: `\`x * Math.PI / n\` ${fraction}.`,
  },
  {
    selector: `BinaryExpression[operator='/'][right.object.name='Math'][right.property.name='PI'] > BinaryExpression.left[operator='*'][right.type='Literal']`,
    message: `\`x * n / Math.PI\` ${fraction}.`,
  },
  {
    selector: `BinaryExpression[operator='**'][left.value=2] > CallExpression.right${math('ceil')}[arguments.0.callee.property.name='log2']`,
    message:
      '`2 ** Math.ceil(Math.log2(v))` is `nextPow2(v)` (`packages/math/src/scalar/integers.ts`).',
  },
  {
    selector: `CallExpression${math('pow')}[arguments.0.value=2] > CallExpression.arguments${math('ceil')}[arguments.0.callee.property.name='log2']`,
    message:
      '`Math.pow(2, Math.ceil(Math.log2(v)))` is `nextPow2(v)` (`packages/math/src/scalar/integers.ts`).',
  },
]

/** The maths themselves, where every form has its one home. */
export const MATHS_HOME = 'packages/math/**'

/** Where the forms are written on purpose, the declared oracles: the bench's reference
 *  implementations and the witness library, the image metric's reference, the test kit's
 *  references, the before-forms a rewrite is proved against, and the test modules, fixtures and
 *  GPU proofs (`isTestModule`, `scripts/repository-files.ts`), whose expectations are their own
 *  arithmetic, independent of the code they check. */
export const MATHS_ORACLES = [
  'bench/oracles/**',
  'bench/witnesses/**',
  'bench/runner/references/flip.ts',
  'tests/kit/reference/**',
  '**/*Before.fixture.ts',
  '**/*.{test,fixture,perf,gpu}.{ts,mts}',
]

/** Whether `file`, a path from the repository root, is one of the declared oracles. */
export const isMathsOracle = (file: string) => MATHS_ORACLES.some((glob) => matchesGlob(file, glob))
