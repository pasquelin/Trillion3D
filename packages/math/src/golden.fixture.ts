import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * The TypeScript reader of the reference values in `packages/math/golden/<file>.json`, which the
 * Rust twins write and check (`packages/math/rust/src/golden.rs`): each section a list of cases,
 * each case its inputs and the Rust twin's outputs, every value typed and written by its bits —
 * `f64:` and `f32:` the hexadecimal bits of the float, `u32:` and `i32:` the decimal integer.
 */
type Kind = 'f64' | 'f32' | 'u32' | 'i32'

/** One input or output of a case: its kind and its number. */
type Value = { kind: Kind; value: number }

/** One case: its inputs, the outputs the Rust twin returns, and the line that holds them. */
type GoldenCase = { inputs: Value[]; outputs: Value[]; line: string }

type Section = { cases: { in: string[]; out: string[] }[] }

const view = new DataView(new ArrayBuffer(8))

/** The value a token of the file names, decoded from its exact bits. */
function parseValue(token: string): Value {
  const [kind, text] = token.split(':') as [Kind, string]
  if (kind === 'f64') {
    view.setBigUint64(0, BigInt(`0x${text}`))
    return { kind, value: view.getFloat64(0) }
  }
  if (kind === 'f32') {
    view.setUint32(0, Number.parseInt(text, 16))
    return { kind, value: view.getFloat32(0) }
  }
  if (kind === 'u32' || kind === 'i32') return { kind, value: Number(text) }
  throw new Error(`unknown value kind in ${token}`)
}

/** Whether `value` is a number of `kind` at all: an `f32` one of its floats, an integer in range. */
function holds(kind: Kind, value: number) {
  if (kind === 'f64') return typeof value === 'number'
  if (kind === 'f32') return Object.is(Math.fround(value), value)
  if (!Number.isInteger(value)) return false
  return kind === 'u32' ? value >= 0 && value <= 0xffffffff : (value | 0) === value
}

/** `value` as the file writes a value of `kind`, a NaN as the quiet NaN of its width; a number
 *  that is not of that kind is shown as it is. */
function token(kind: Kind, value: number): string {
  if (!holds(kind, value)) return `${kind}?${value}`
  if (kind === 'f64') {
    view.setFloat64(0, Number.isNaN(value) ? NaN : value)
    return `f64:${view.getBigUint64(0).toString(16).padStart(16, '0')}`
  }
  if (kind === 'f32') {
    view.setFloat32(0, Number.isNaN(value) ? NaN : value)
    return `f32:${view.getUint32(0).toString(16).padStart(8, '0')}`
  }
  return `${kind}:${value}`
}

/** The same value, as the Rust side matches it: the same kind and bits, or two NaN of one width. */
function matches(expected: Value, actual: number): boolean {
  return holds(expected.kind, actual) && Object.is(expected.value, actual)
}

/** The package's reference values, beside its sources. */
const GOLDEN = new URL('../golden/', import.meta.url)

/** The cases of section `name` of `packages/math/golden/<file>.json`. */
function goldenCases(file: string, name: string): GoldenCase[] {
  const text = readFileSync(new URL(`${file}.json`, GOLDEN), 'utf8')
  const section = (JSON.parse(text) as Record<string, Section>)[name]
  assert.ok(section?.cases, `${file}.json has a section ${name}`)
  return section.cases.map((c) => ({
    inputs: c.in.map(parseValue),
    outputs: c.out.map(parseValue),
    line: JSON.stringify(c),
  }))
}

/**
 * Reads each case of section `name` of `file` — its input numbers and the outputs the Rust twin
 * wrote — for a reader that takes the twin's outputs as its own input (a shader decoding them),
 * which `assertGolden` cannot hold to the file.
 */
export function eachGolden(
  file: string,
  name: string,
  check: (inputs: number[], outputs: number[], line: string) => void,
) {
  const cases = goldenCases(file, name)
  assert.ok(cases.length > 0, `${file} ${name}: no case`)
  for (const { inputs, outputs, line } of cases)
    check(
      inputs.map((v) => v.value),
      outputs.map((v) => v.value),
      line,
    )
}

/**
 * Asserts that `compute` returns, on the inputs of every case of section `name` of `file`, the
 * outputs the Rust twin wrote, bit for bit; it reads the input numbers and returns the output
 * numbers, none for an input the twin refuses. Every case that differs is listed at once.
 */
export function assertGolden(
  file: string,
  name: string,
  compute: (inputs: number[]) => ArrayLike<number>,
) {
  const cases = goldenCases(file, name)
  assert.ok(cases.length > 0, `${file} ${name}: no case`)
  const wrong: string[] = []
  for (const { inputs, outputs, line } of cases) {
    const actual = Array.from(compute(inputs.map((v) => v.value)))
    const same =
      actual.length === outputs.length && outputs.every((value, k) => matches(value, actual[k]))
    if (!same) {
      const kinds = outputs.length ? outputs.map((v) => v.kind) : actual.map((): Kind => 'f64')
      wrong.push(
        `${line} returns ${JSON.stringify(actual.map((v, k) => token(kinds[k] ?? 'f64', v)))}`,
      )
    }
  }
  assert.deepEqual(wrong, [], `${file} ${name}: ${wrong.length} of ${cases.length} cases differ`)
}
