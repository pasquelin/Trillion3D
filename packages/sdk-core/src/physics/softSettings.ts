import type { PhysicsBodyOptions } from './options.ts'
import type { SoftBodyOptions, SoftSettings } from './soft.ts'

/** Reads a soft body's options, refusing a value out of its range. */
export function softSettings(o: SoftBodyOptions): SoftSettings {
  const rigid = o as unknown as PhysicsBodyOptions
  for (const name of ['shape', 'sensor', 'ccd', 'decorative'] as const)
    if (rigid[name] !== undefined) throw new RangeError(`A soft body takes no ${name}.`)
  if (rigid.damping?.angular !== undefined)
    throw new RangeError('A soft body takes no angular damping: its vertices do not turn.')
  const { pins = [], mass, stretch = 0, bend = Infinity } = o
  const pressure = o.type === 'volume' ? o.pressure : 0
  for (const [name, value] of Object.entries({ stretch, bend, mass, pressure }))
    if (value !== undefined && !(value >= 0))
      throw new RangeError(`A soft body's ${name} is 0 and up: ${value}.`)
  return { type: o.type, pins: [...pins], mass, stretch, bend, pressure }
}
