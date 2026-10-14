import { FLOAT32_MIN_NORMAL, FLOAT32_STEP } from '../constants.ts'

/**
 * The two guards of a containment proved in single precision — a rejection or a bound that holds
 * for the exact value although the GPU computes it in `f32` (the transparents' frustum verdict, the
 * water rectangle). `ROUNDING_GAMMA` is `γ₈ = 8ε / (1 − 8ε)` for a unit `ε` of four float32 steps
 * at 1 (`FLOAT32_STEP`), about 64 units of the roundoff `u = 2⁻²⁴`: it covers the relative error of
 * conversions, products and sums in any order or fused, and WGSL's division. `FLUSH` is eight of the
 * least normal `2⁻¹²⁶`: the absolute error of a subnormal a backend may flush to zero.
 */
export const ROUNDING_GAMMA = (32 * FLOAT32_STEP) / (1 - 32 * FLOAT32_STEP)
export const FLUSH = 8 * FLOAT32_MIN_NORMAL
