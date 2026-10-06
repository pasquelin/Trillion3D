import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import test from 'node:test'
import { DEFAULT_LANGUAGE, LANGUAGES } from '../site/content/i18n/dictionary.ts'
import { codeBlocks, installPageHtml, repositoryLinks, walkthrough } from './install-page.ts'

const root = new URL('../', import.meta.url)
const english = await installPageHtml(DEFAULT_LANGUAGE)

test('the Install page installs, compiles, draws and names its two headers', () => {
  const { commands, page, headers } = walkthrough(codeBlocks(english))
  assert.deepEqual(commands, [
    'npm install trillion3d',
    'npx trillion3d-compile public/model.glb public/model slice 150000 /',
  ])
  assert.match(
    page,
    /"trillion3d": "https:\/\/cdn\.jsdelivr\.net\/npm\/trillion3d\/dist\/trillion3d\.module\.js"/,
  )
  assert.match(page, /scene\.load\('\/model\/native\/slice\/manifest\.json'\)/)
  assert.deepEqual(headers, {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'credentialless',
  })
})

test('every language gives English its commands and its links', async () => {
  const [blocks, links] = [codeBlocks(english), repositoryLinks(english)]
  for (const { code } of LANGUAGES) {
    const html = await installPageHtml(code)
    assert.deepEqual(codeBlocks(html), blocks, `${code}: its code blocks`)
    assert.deepEqual(repositoryLinks(html), links, `${code}: its links`)
  }
})

test('every repository link of the page exists', () => {
  const links = repositoryLinks(english)
  for (const path of links) assert.ok(existsSync(new URL(path, root)), `${path} exists`)
  assert.ok(links.includes('LICENSE'))
})

test('a page without a step is refused by name', () => {
  assert.throws(() => walkthrough(['npm install trillion3d']), /compiles nothing/)
  const blocks = codeBlocks(english).filter((block) => !block.startsWith('Cross-Origin-'))
  assert.throws(() => walkthrough(blocks), /no server header/)
})
