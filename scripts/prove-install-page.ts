#!/usr/bin/env node
/**
 * The portal's Install page, walked through (#1355): its English commands run in a clean folder,
 * as a newcomer copies them. Until `trillion3d` is on npm, the registry is the one stand-in:
 * `npm install trillion3d` installs the archive this checkout packs, and the folder's `overrides`
 * point the compiler's platform packages at theirs. The page's `npx trillion3d-compile` compiles
 * the fixture model; the page it gives is saved as `public/index.html`, served with its two headers
 * — the CDN of its `importmap` played by the installed package, from another origin — and opened in
 * Chrome, where it must draw the model.
 *
 * `node scripts/prove-install-page.ts [--model <file>]`: a Chrome proof, the recette's (AGENTS.md
 * rule 2). The default model is the morphing cube of the examples, a 2-unit cube at the origin.
 */
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { launchChrome } from '../bench/runner/harness/chrome.ts'
import { drawnShare } from './docs/examples/capture.ts'
import { currentCompilerExecutable } from '../packages/sdk-node/src/compiler/executable.mts'
import { codeBlocks, installPageHtml, walkthrough } from './install-page.ts'
import { createInstalledFixture, packArchive } from './installed-package/fixture.ts'
import { packPlatformPackages } from './installed-package/platforms.ts'
import { listen, staticServer } from './static-server.ts'

/** The CDN the page's `importmap` names, and where the fixture server plays it. */
const CDN = 'https://cdn.jsdelivr.net/npm/trillion3d/'
const LOCAL_CDN = '/cdn/trillion3d/'
/** The share of the canvas that must differ from its corner once the model is drawn. */
const DRAWN = 0.01
/** The summed channel distance from the canvas's corner at which a pixel counts as drawn. */
const DRAWN_DISTANCE = 24

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const { values } = parseArgs({
  options: {
    model: {
      type: 'string',
      default: join(root, 'site/assets/examples/animated-morph-cube/source/AnimatedMorphCube.glb'),
    },
  },
})
const windows = process.platform === 'win32'
const [pnpm, npm, npx] = ['pnpm', 'npm', 'npx'].map((name) => (windows ? `${name}.cmd` : name))
// The page is read before the clean folder is made: a page missing a step leaves no folder behind.
const { commands, page, headers } = walkthrough(codeBlocks(await installPageHtml('en')))
const { fixture, logs, run } = createInstalledFixture(root)
// The compiler comes from the installed platform package, never from a variable of this shell.
const { TRILLION3D_COMPILER_BIN: _named, ...environment } = process.env

async function draw(app: string) {
  let port = 0
  const server = staticServer({
    mounts: [
      { prefix: LOCAL_CDN, dir: join(app, 'node_modules/trillion3d') },
      { prefix: '/', dir: join(app, 'public') },
    ],
    headers: { ...headers, 'access-control-allow-origin': '*' },
    // The page's CDN is served here, from `localhost`: another origin than the page's, as a CDN is.
    transform: (file) =>
      file.endsWith('index.html')
        ? { type: 'text/html', text: page.replace(CDN, `http://localhost:${port}${LOCAL_CDN}`) }
        : undefined,
  })
  port = await listen(server)
  let browser: Awaited<ReturnType<typeof launchChrome>> | undefined
  const errors: string[] = []
  try {
    // Launched inside the `try`: a Chrome that fails to start still closes the server, and the
    // proof exits instead of waiting on it.
    browser = await launchChrome({ headless: true })
    const tab = await browser.newPage({ viewport: { width: 640, height: 400 } })
    tab.on('pageerror', (error) => errors.push(error.message))
    await tab.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'networkidle' })
    const isolated = await tab.evaluate(() => crossOriginIsolated)
    let drawn = 0
    for (let tries = 0; tries < 60 && drawn < DRAWN && !errors.length; tries++) {
      drawn = await drawnShare(tab, 'canvas#viewer', DRAWN_DISTANCE)
      if (drawn < DRAWN) await tab.waitForTimeout(500)
    }
    if (errors.length) throw new Error(`the page failed: ${errors.join('; ')}`)
    if (drawn < DRAWN) throw new Error(`the page drew ${(drawn * 100).toFixed(2)} % of its canvas`)
    return { isolated, drawn: Number(drawn.toFixed(3)) }
  } finally {
    await browser?.close()
    await new Promise((settle) => server.close(settle))
  }
}

try {
  run(pnpm, ['run', 'build'])
  run(pnpm, ['run', 'build:native'])
  const binary = currentCompilerExecutable(undefined, {})
  const { filename: archive } = packArchive(run, pnpm, root, fixture)
  // The platform packages' pnpm `overrides`, one `"name": "file:archive"` line each under an
  // `overrides:` header (that exact text of `packPlatformPackages`), are npm's too.
  const [, ...lines] = packPlatformPackages({ root, fixture, run, pnpm, binary }).trim().split('\n')
  const overrides = JSON.parse(`{${lines.join(',')}}`) as Record<string, string>
  const app = join(fixture, 'app')
  mkdirSync(join(app, 'public'), { recursive: true })
  writeFileSync(join(app, 'package.json'), `${JSON.stringify({ private: true, overrides })}\n`)
  const compiled: unknown[] = []
  for (const command of commands) {
    const [tool, ...args] = command.split(' ')
    if (tool === 'npm') {
      run(
        npm,
        args.map((arg) => (arg === 'trillion3d' ? archive : arg)),
        app,
        environment,
      )
      continue
    }
    if (args[0] !== 'trillion3d-compile') throw new Error(`${command}: not a step of the page`)
    // The model the page names is the fixture, copied where the page expects it.
    copyFileSync(values.model, join(app, args[1]))
    const result = JSON.parse(run(npx, args, app, environment)) as { status: string }
    if (result.status !== 'ready') throw new Error(`${command}: ${result.status}`)
    compiled.push(result)
  }
  writeFileSync(join(app, 'public/index.html'), page)
  const drawn = await draw(app)
  console.log(JSON.stringify({ commands, model: values.model, compiled, ...drawn }, null, 2))
} catch (error) {
  console.error(JSON.stringify({ error: String(error), fixture, logs }, null, 2))
  process.exitCode = 1
} finally {
  rmSync(fixture, { recursive: true, force: true })
}
