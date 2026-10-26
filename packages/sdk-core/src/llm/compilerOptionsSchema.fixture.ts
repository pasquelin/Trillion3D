// The compiler options schema, compiled, and a job that names only what a job must, which the tests
// of the compile schema share.
import { Ajv } from 'ajv'
import { COMPILER_OPTIONS_SCHEMA } from './compilerOptionsSchema.ts'

export const validate = new Ajv().compile(COMPILER_OPTIONS_SCHEMA)
export const job = {
  source: 'model.glb',
  cache: 'cache/model',
  resourceBaseUrl: '/assets/model/',
}
