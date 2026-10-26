import { isAbsolute, resolve } from 'node:path'
import ts from 'typescript'
import { REPOSITORY_ROOT } from '../../scripts/git/repository-files.ts'

/** The type errors of `file`, a path from the repository root or absolute, under `options`. */
export function diagnostics(file: string, options: ts.CompilerOptions): string[] {
  const program = ts.createProgram([isAbsolute(file) ? file : resolve(REPOSITORY_ROOT, file)], {
    target: ts.ScriptTarget.ES2022,
    strict: true,
    skipLibCheck: false,
    noEmit: true,
    ...options,
  })
  return ts
    .getPreEmitDiagnostics(program)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
}

/** How a host compiles each of the package's three faces: Node with NodeNext, the browser with
 *  its condition and the WebGPU types, and the common face with neither. */
export const HOSTS = {
  node: {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    types: ['node'],
  },
  browser: {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    customConditions: ['browser'],
    lib: ['lib.es2023.d.ts', 'lib.dom.d.ts'],
    types: ['@webgpu/types'],
  },
  common: {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2023.d.ts'],
    types: ['node'],
  },
} satisfies Record<string, ts.CompilerOptions>
