import type { ValueType } from '../../../../sdk-core/src/world/material/graph/valueType.ts'
import { wgslType, type Value } from './value.ts'

/**
 * The lines of a function being written. A value that is computed is held in a local, so the
 * function names it once wherever it is read; a read that costs nothing (a field of the context,
 * a constant) is written where it is used.
 */
export class Emitter {
  readonly lines: string[] = []
  private count = 0

  /** Holds `expression` in a new local of `type`; the value reads the local. */
  local(type: ValueType, expression: string): Value {
    const name = `v${this.count++}`
    this.lines.push(`let ${name}:${wgslType(type)}=${expression};`)
    return { type, code: name }
  }
}
