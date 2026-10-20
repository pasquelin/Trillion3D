import { wgslConst } from '../../../../../math/src/wgsl/decl.ts'
import { FINITE_SENTINEL } from '../../../../../math/src/wgsl/constants.ts'

/** The DAG kernels' `INF`. A WGSL const-expression may not be infinite, so the unreachable band
 *  uses the finite stand-in: every comparison behaves exactly as the oracle's Infinity for any
 *  finite threshold. */
export const DAG_INF = wgslConst('INF', [FINITE_SENTINEL], 'const INF:f32=FINITE_SENTINEL;')
