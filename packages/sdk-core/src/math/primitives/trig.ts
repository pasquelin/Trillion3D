/**
 * fdlibm's sine and arc cosine, as the `libm` crate (0.2.16, `src/math/{sin,k_sin,k_cos,rem_pio2,
 * acos}.rs`, MIT, from musl and FreeBSD msun) writes them: the same bits on every machine, where
 * `Math.sin` and `Math.acos` are the engine's and the machine's (`Math.acos` differs from fdlibm on
 * one arm64 input in two hundred, `packages/page-codec-wasm/src/normal_cone.rs`). Their Rust twins
 * are `packages/page-codec-wasm/src/trig.rs` and `acos.rs`: a kernel that runs either side gives
 * the same numbers. The square root is the instruction's (`Math.sqrt`, correctly rounded, as
 * `libm`'s own). High words are read as thresholds on the magnitude: `|x| < fromHigh(h + 1)` is
 * `highWord(|x|) <= h`.
 *
 * The original notice, which fdlibm asks to keep:
 *
 * Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
 * Developed at SunSoft, a Sun Microsystems, Inc. business. Permission to use, copy, modify, and
 * distribute this software is freely granted, provided that this notice is preserved.
 */

const bits = new Float64Array(1),
  words = new Uint32Array(bits.buffer)
/** The double whose high word is `high`, its low word 0 (little-endian words). */
function fromHigh(high: number) {
  words[1] = high
  words[0] = 0
  return bits[0]
}
/** The biased exponent of `x`. */
function exponent(x: number) {
  bits[0] = x
  return (words[1] >>> 20) & 0x7ff
}

// k_sin.rs, k_cos.rs.
const S1 = -1.66666666666666324348e-1,
  S2 = 8.33333333332248946124e-3,
  S3 = -1.98412698298579493134e-4,
  S4 = 2.75573137070700676789e-6,
  S5 = -2.50507602534068634195e-8,
  S6 = 1.58969099521155010221e-10
const C1 = 4.16666666666666019037e-2,
  C2 = -1.38888888888741095749e-3,
  C3 = 2.48015872894767294178e-5,
  C4 = -2.75573143513906633035e-7,
  C5 = 2.0875723212981748279e-9,
  C6 = -1.13596475577881948265e-11

/** sin(x + y), |x| ≤ π/4, `y` the tail of a reduced argument. */
function kernelSin(x: number, y: number) {
  const z = x * x,
    w = z * z,
    r = S2 + z * (S3 + z * S4) + z * w * (S5 + z * S6),
    v = z * x
  return x - (z * (0.5 * y - v * r) - y - v * S1)
}
/** cos(x + y), |x| ≤ π/4. */
function kernelCos(x: number, y: number) {
  const z = x * x,
    w = z * z,
    r = z * (C1 + z * (C2 + z * C3)) + w * w * (C4 + z * (C5 + z * C6)),
    hz = 0.5 * z,
    u = 1 - hz
  return u + (1 - u - hz + (z * r - x * y))
}

// rem_pio2.rs.
const TO_INT = 1.5 / 2.2204460492503131e-16,
  INV_PIO2 = 6.36619772367581382433e-1,
  PIO2_1 = 1.57079632673412561417,
  PIO2_1T = 6.07710050650619224932e-11,
  PIO2_2 = 6.0771005063039659766e-11,
  PIO2_2T = 2.02226624879595063154e-21,
  PIO2_3 = 2.0222662487111664558e-21,
  PIO2_3T = 8.47842766036889956997e-32
const BELOW_2_26 = fromHigh(0x3e500000),
  PIO4 = fromHigh(0x3fe921fc),
  PIO3_4 = fromHigh(0x4002d97d),
  PIO5_4 = fromHigh(0x400f6a7b),
  PIO7_4 = fromHigh(0x4015fdbd),
  PIO9_4 = fromHigh(0x401c463c),
  MEDIUM_END = fromHigh(0x413921fb)
/** The reduced argument `y0 + y1` of the last reduction. */
const reduced = new Float64Array(2)

/** `rint(x / (π/2))` and the remainder, in three rounds as precision asks (|x| < 2^20 · π/2). */
function medium(x: number) {
  const ex = exponent(x),
    fn = x * INV_PIO2 + TO_INT - TO_INT
  let r = x - fn * PIO2_1,
    w = fn * PIO2_1T,
    y0 = r - w
  if (ex - exponent(y0) > 16) {
    let t = r
    w = fn * PIO2_2
    r = t - w
    w = fn * PIO2_2T - (t - r - w)
    y0 = r - w
    if (ex - exponent(y0) > 49) {
      t = r
      w = fn * PIO2_3
      r = t - w
      w = fn * PIO2_3T - (t - r - w)
      y0 = r - w
    }
  }
  reduced[0] = y0
  reduced[1] = r - y0 - w
  return fn
}
/** `x` less `n` quarter turns, one round (85 bits): `n` from 1 to 4, of `x`'s sign. */
function quarterTurns(x: number, n: number) {
  const k = x < 0 ? -n : n,
    z = x - k * PIO2_1,
    y0 = z - k * PIO2_1T
  reduced[0] = y0
  reduced[1] = z - y0 - k * PIO2_1T
  return k
}
/** The high word of `a`. */
function highWord(a: number) {
  bits[0] = a
  return words[1]
}
/** Whether the 20 mantissa bits of `a`'s high word are π/2's, `0x921fb`: a near multiple of π/2,
 *  whose one-round reduction would cancel. */
const nearHalfTurns = (a: number) => (highWord(a) & 0xfffff) === 0x921fb

/** π/2's high word, `0x3ff921fb`, as a range of magnitudes: there one round would cancel. */
const HALF_TURN_FROM = fromHigh(0x3ff921fb),
  HALF_TURN_TO = fromHigh(0x3ff921fc)

/**
 * sin x, fdlibm's bits for |x| < 2^20 · π/2 (and NaN for NaN or an infinity); beyond, where the
 * reduction needs Payne–Hanek, `Math.sin`'s. A slerp's angles stay within [0, π/2]: below π/4 the
 * kernel, up to 3π/4 one quarter turn off, both written here in line; the rest in `sinReduced`.
 */
export function fdlibmSin(x: number) {
  const a = Math.abs(x)
  if (a < PIO4) return a < BELOW_2_26 ? x : kernelSinAlone(x)
  if (a < PIO3_4 && (a < HALF_TURN_FROM || !(a < HALF_TURN_TO)))
    return x > 0 ? kernelCosOff(x - PIO2_1, PIO2_1T) : -kernelCosOff(x + PIO2_1, -PIO2_1T)
  return sinReduced(x, a)
}

/** sin x, |x| ≤ π/4: the kernel without a tail. */
function kernelSinAlone(x: number) {
  const z = x * x,
    w = z * z,
    r = S2 + z * (S3 + z * S4) + z * w * (S5 + z * S6),
    v = z * x
  return x + v * (S1 + z * r)
}
/** cos of `z` less `tail` (one quarter turn's low part, signed), reduced in one round. */
function kernelCosOff(z: number, tail: number) {
  const y0 = z - tail
  return kernelCos(y0, z - y0 - tail)
}

/** `fdlibmSin` from 3π/4, or near π/2: libm's `rem_pio2` branches, then the kernel by quadrant. */
function sinReduced(x: number, a: number) {
  if (!(a < Infinity)) return x - x
  let n: number
  if (a < PIO5_4) {
    if (nearHalfTurns(a)) n = medium(x)
    else n = quarterTurns(x, a < PIO3_4 ? 1 : 2)
  } else if (a < PIO9_4) {
    if (a < PIO7_4) n = highWord(a) === 0x4012d97c ? medium(x) : quarterTurns(x, 3)
    else n = highWord(a) === 0x401921fb ? medium(x) : quarterTurns(x, 4)
  } else if (a < MEDIUM_END) n = medium(x)
  else return Math.sin(x)
  const y0 = reduced[0],
    y1 = reduced[1]
  switch (n & 3) {
    case 0:
      return kernelSin(y0, y1)
    case 1:
      return kernelCos(y0, y1)
    case 2:
      return -kernelSin(y0, y1)
    default:
      return -kernelCos(y0, y1)
  }
}

// acos.rs.
const PIO2_HI = 1.570796326794896558,
  PIO2_LO = 6.12323399573676603587e-17,
  PS0 = 1.66666666666666657415e-1,
  PS1 = -3.25565818622400915405e-1,
  PS2 = 2.01212532134862925881e-1,
  PS3 = -4.00555345006794114027e-2,
  PS4 = 7.91534994289814532176e-4,
  PS5 = 3.4793310759602116757e-5,
  QS1 = -2.40339491173441421878,
  QS2 = 2.02094576023350569471,
  QS3 = -6.8828397160545329303e-1,
  QS4 = 7.70381505559019352791e-2
const BELOW_2_57 = fromHigh(0x3c600001)
/** 2^(e − 1023) for each biased exponent `e` of a finite double. */
const POWERS_OF_TWO = Float64Array.from({ length: 2047 }, (_, e) => 2 ** (e - 1023))

/** The rational part `R(z)` of fdlibm's arc sine. */
function rational(z: number) {
  const p = z * (PS0 + z * (PS1 + z * (PS2 + z * (PS3 + z * (PS4 + z * PS5))))),
    q = 1 + z * (QS1 + z * (QS2 + z * (QS3 + z * QS4)))
  return p / q
}

/** acos x, fdlibm's bits everywhere: `0` at 1, `π` at −1, NaN beyond ±1 or for NaN. */
export function fdlibmAcos(x: number) {
  const a = Math.abs(x)
  if (!(a < 1)) return x === 1 ? 0 : x === -1 ? 2 * PIO2_HI : NaN
  if (a < 0.5) {
    if (a < BELOW_2_57) return PIO2_HI
    return PIO2_HI - (x - (PIO2_LO - x * rational(x * x)))
  }
  if (x < 0) {
    const z = (1 + x) * 0.5,
      s = Math.sqrt(z),
      w = rational(z) * s - PIO2_LO
    return 2 * (PIO2_HI - (s + w))
  }
  const z = (1 - x) * 0.5,
    s = Math.sqrt(z)
  // `s` with its low word cleared, its high part whose square is exact: rebuilt from the high
  // word, its exponent's power of two times 1 and twenty bits (s >= 2^-27, a normal number).
  const high = highWord(s),
    df = POWERS_OF_TWO[high >>> 20] * (1 + (high & 0xfffff) * 2 ** -20),
    c = (z - df * df) / (s + df),
    w = rational(z) * s + c
  return 2 * (df + w)
}
