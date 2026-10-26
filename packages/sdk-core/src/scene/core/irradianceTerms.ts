// The nine terms of the order-2 basis (`irradianceBasis.ts`), in the engine's band order.
import { IRRADIANCE_BAND } from './environment.ts'

/** One term of the basis. */
export interface IrradianceTerm {
  /** Normalisation of the real harmonic: `Y_k(ω) = basis · polynomial(ω)`. */
  basis: number
  /** Cosine-lobe factor `Â_l · basis`: the term's irradiance is `L_k · band · polynomial(n)`. */
  band: number
  /** `basis` as the sky light's projection and the volumetric lightmap's file format write it: six
   *  digits, signed with the real harmonics' sign (negative on the terms 1, 3, 5 and 7). */
  contract: number
  /** The polynomial in the components of a unit vector named `v`, as WGSL shader text. With `squares`,
   *  the name of a vector holding the squares of `v`'s components, the terms that square a component
   *  read it there instead of multiplying it by itself. */
  polynomial: (v: string, squares?: string) => string
}

/** The square of component `axis` of `v`, read from the vector `squares` of the squares when given. */
const square = (v: string, axis: string, squares?: string) =>
  squares ? `${squares}.${axis}` : `${v}.${axis}*${v}.${axis}`

const constant = 0.2820948,
  linear = 0.4886025,
  cross = 1.0925484

/** The nine terms, in band order. */
export const IRRADIANCE_TERMS: readonly IrradianceTerm[] = [
  { basis: constant, contract: 0.282095, band: IRRADIANCE_BAND.constant, polynomial: () => '1.0' },
  {
    basis: linear,
    contract: -0.488603,
    band: IRRADIANCE_BAND.linear,
    polynomial: (v) => `${v}.y`,
  },
  { basis: linear, contract: 0.488603, band: IRRADIANCE_BAND.linear, polynomial: (v) => `${v}.z` },
  {
    basis: linear,
    contract: -0.488603,
    band: IRRADIANCE_BAND.linear,
    polynomial: (v) => `${v}.x`,
  },
  {
    basis: cross,
    contract: 1.092548,
    band: IRRADIANCE_BAND.quadraticCross,
    polynomial: (v) => `${v}.x*${v}.y`,
  },
  {
    basis: cross,
    contract: -1.092548,
    band: IRRADIANCE_BAND.quadraticCross,
    polynomial: (v) => `${v}.y*${v}.z`,
  },
  {
    basis: 0.3153916,
    contract: 0.315392,
    band: IRRADIANCE_BAND.quadraticZ,
    polynomial: (v, squares) => `3.0*${square(v, 'z', squares)}-1.0`,
  },
  {
    basis: cross,
    contract: -1.092548,
    band: IRRADIANCE_BAND.quadraticCross,
    polynomial: (v) => `${v}.x*${v}.z`,
  },
  {
    basis: 0.5462742,
    contract: 0.546274,
    band: IRRADIANCE_BAND.quadraticDifference,
    polynomial: (v, squares) => `${square(v, 'x', squares)}-${square(v, 'y', squares)}`,
  },
]
