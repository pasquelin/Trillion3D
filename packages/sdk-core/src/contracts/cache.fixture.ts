// The metadata and the refusal check the tests of `cache.ts` share.
import assert from 'node:assert/strict'
import { DAG_ERROR_MODEL, FORMAT_VERSION } from './base.ts'
import { assertCacheIdentity, EngineError } from './cache.ts'

export const root = {
  formatVersion: FORMAT_VERSION,
  status: 'ready',
  scope: 'full',
  primitives: [],
  selectedNodes: 0,
  selectedTriangles: 0,
}
export const identity = {
  formatVersion: FORMAT_VERSION,
  errorModel: DAG_ERROR_MODEL,
  primitives: [],
}
/** `work` throws an engine error of `code`, with `details` and words naming each of `facts`;
 *  returns its message. */
export const refuses = (
  work: () => unknown,
  code: string,
  details?: Record<string, unknown>,
  facts: string[] = [],
) => {
  let message = ''
  assert.throws(work, (error) => {
    assert.ok(error instanceof EngineError)
    assert.equal(error.name, 'EngineError')
    assert.equal(error.code, code)
    assert.ok(error.message.trim().length > 0)
    for (const fact of facts) assert.ok(error.message.includes(fact), `${error.message}: ${fact}`)
    if (details) assert.deepEqual(error.details, details)
    message = error.message
    return true
  })
  return message
}
export const refusesIdentity = (
  value: object,
  ...rest: [string, Record<string, unknown>?, string[]?]
) => refuses(() => assertCacheIdentity(value as never), ...rest)
