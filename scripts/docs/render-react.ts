import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { LANGUAGES } from '../../site/content/i18n/dictionary.ts'
import { externalEngine, PROGRAM_TEXT } from './external-engine.ts'
import { inlineModules } from './inline-modules.ts'
import { REPOSITORY_ROOT } from '../repository-files.ts'

/** Compile maintained TSX for server-rendered component contract tests, with every language's
 *  words read, as a page in that language reads them before it renders. */
export async function loadReactComponents(relativePath: string): Promise<Record<string, unknown>> {
  const output = await build({
    absWorkingDir: REPOSITORY_ROOT,
    stdin: {
      contents: [
        `export * from './${relativePath}';`,
        "export { loadLanguage as loadLanguageOfBundle } from './site/app/i18n.ts';",
      ].join('\n'),
      resolveDir: REPOSITORY_ROOT,
      loader: 'ts',
    },
    bundle: true,
    write: false,
    jsx: 'automatic',
    format: 'cjs',
    platform: 'node',
    packages: 'external',
    plugins: [externalEngine, inlineModules],
    loader: PROGRAM_TEXT,
    logLevel: 'silent',
  })
  const module: { exports: Record<string, unknown> } = { exports: {} }
  const require = createRequire(resolve(REPOSITORY_ROOT, relativePath))
  new Function('require', 'module', 'exports', output.outputFiles[0].text)(
    require,
    module,
    module.exports,
  )
  const { loadLanguageOfBundle, ...exports } = module.exports
  await Promise.all(
    LANGUAGES.map(({ code }) => (loadLanguageOfBundle as (code: string) => Promise<void>)(code)),
  )
  return exports
}
