// The nine terms of the order-2 basis (`irradianceBasis.ts`), in the engine's band order.
import { IRRADIANCE_BAND } from './environment.ts'

/** One term of the basis. */
export interface IrradianceTerm {
  /** Normalisation of the real harmonic: `Y_k(ω) = basis · polynomial(ω)`. */
  basis: number
  /** Cosine-lobe factor `Â_l · basis`: the term's irradiance is `L_k · band · polynomial(n)`. */
  band: number
  /** The polynomial in the components of a unit vector named `v`, as shader text valid in WGSL
   *  and GLSL alike. */
  polynomial: (v: string) => string
}

const constant = 0.2820948,
  linear = 0.4886025,
  cross = 1.0925484

/** The nine terms, in band order. */
export const IRRADIANCE_TERMS: readonly IrradianceTerm[] = [
  { basis: constant, band: IRRADIANCE_BAND.constant, polynomial: () => '1.0' },
  { basis: linear, band: IRRADIANCE_BAND.linear, polynomial: (v) => `${v}.y` },
  { basis: linear, band: IRRADIANCE_BAND.linear, polynomial: (v) => `${v}.z` },
  { basis: linear, band: IRRADIANCE_BAND.linear, polynomial: (v) => `${v}.x` },
  { basis: cross, band: IRRADIANCE_BAND.quadraticCross, polynomial: (v) => `${v}.x*${v}.y` },
  { basis: cross, band: IRRADIANCE_BAND.quadraticCross, polynomial: (v) => `${v}.y*${v}.z` },
  {
    basis: 0.3153916,
    band: IRRADIANCE_BAND.quadraticZ,
    polynomial: (v) => `3.0*${v}.z*${v}.z-1.0`,
  },
  { basis: cross, band: IRRADIANCE_BAND.quadraticCross, polynomial: (v) => `${v}.x*${v}.z` },
  {
    basis: 0.5462742,
    band: IRRADIANCE_BAND.quadraticDifference,
    polynomial: (v) => `${v}.x*${v}.x-${v}.y*${v}.y`,
  },
]
