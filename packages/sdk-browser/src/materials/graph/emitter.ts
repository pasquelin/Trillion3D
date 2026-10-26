import type { ValueType } from '../../../../sdk-core/src/world/material/graph/valueType.ts'
import { wgslType, type Value } from './value.ts'

/** A parameter's slot, which every pixel reads the same. */
const PARAMETER = /g\.v\[\d+\]/g
/** A name in an expression that is not a field, a swizzle or a call. */
const NAME = /(?<![\w.])[A-Za-z_]\w*(?![\w(])/g

/**
 * The lines of a function being written. A value that is computed is held in a local, so the
 * function names it once wherever it is read; a read that costs nothing (a field of the context,
 * a constant) is written where it is used.
 */
export class Emitter {
  readonly lines: string[] = []
  private count = 0
  private readonly fixed = new Set<string>()

  /** Holds `expression` in a new local of `type`; the value reads the local. */
  local(type: ValueType, expression: string): Value {
    const name = `v${this.count++}`
    this.lines.push(`let ${name}:${wgslType(type)}=${expression};`)
    if (this.isFixed(expression)) this.fixed.add(name)
    return { type, code: name }
  }

  /** Whether `value` is the same at every pixel: a constant, a parameter, or what is computed from
   *  these alone. */
  uniform(value: Value) {
    return !!value.constant || this.isFixed(value.code)
  }

  private isFixed(code: string) {
    return (code.replace(PARAMETER, '').match(NAME) ?? []).every((name) => this.fixed.has(name))
  }
}
