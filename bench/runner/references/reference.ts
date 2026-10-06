#!/usr/bin/env node
// The engine's reference images (#1281), regenerated on demand by one command:
//   node bench/runner/references/reference.ts [--scene sponza,facade-7] [--after <dist|ref>] [--references <dir>]
// `reference.json` goes to `bench/references/` (git), the images to `.mesure/references/` (off git);
// `--references <dir>` writes both there.
// Each scene's bench poses (`trajectory/poses.ts`), at the boss's case (`REFERENCE_ARGS`, any bench flag after
// them wins), drawn by the engine's reference mode and written with the commit that drew them.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Page } from 'playwright';
import { encodePng } from '../../../packages/sdk-node/src/cutout/png.mts';
import { sha256 } from '../../../packages/sdk-node/src/compiler/provenance.mts';
import { startServer, type Capture } from '../../../tests/kit/server/staticServer.ts';
import { onFreshPage } from '../chrome.ts';
import { benchLights } from '../lamps.ts';
import * as options from '../options.ts';
import type * as ReferencePage from './referencePage.ts';
import {
  REFERENCE_ARGS,
  REFERENCE_SCENES,
  REFERENCES_DIR,
  REFERENCE_IMAGES_DIR,
  imageSettings,
  type ReferenceRecord,
} from './referenceStore.ts';
import { measurePayload, withGpuIncidents } from '../series/seriesPage.ts';
import { readStreet } from '../street/street.ts';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '../../..');
const git = (...args: string[]) =>
  execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' }).trim();

/** One scene: its poses drawn in reference mode, the record written under `<dir>/<scene>/`, the
 *  images under `<images>/<scene>/`. */
async function referenceScene(argv: string[], scene: string, dir: string, images: string) {
  const { flags, settings, views } = options.readOptions(
    [...REFERENCE_ARGS, ...argv, '--scene', scene],
    ROOT,
  );
  const { sides, after } = options.equipSides(flags, settings);
  flags.refuseUnread();
  const [side] = sides;
  Object.assign(side, options.resolveSides({ after, root: ROOT })[0]);
  const manifest = options.assetsManifest(scene, !side.cache);
  side.manifestUrl = side.cache ? `/cache/${side.name}/native/full/manifest.json` : manifest;
  const captures = new Map<string, Capture>();
  const mounts = options.resolveMounts(ROOT, sides, null);
  const { server, port } = await startServer({ port: settings.port, mounts, captures });
  const view = {
    url: `http://127.0.0.1:${port}/`,
    width: settings.width,
    height: settings.height,
    dpr: settings.dpr,
  };
  const onPage = <T>(run: (page: Page) => Promise<T>) =>
    onFreshPage({ headless: !settings.visible, args: side.engine.flags }, view, run);
  // The engine commit that drew them: the last one to change `packages/` in the tree drawn from,
  // the working tree or the commit `--after` named (`git <sha>` in `dists.ts`).
  const tree = /^git ([0-9a-f]+)/.exec(side.from)?.[1] ?? 'HEAD';
  const commit = git('log', '-1', '--format=%H', tree, '--', 'packages');
  const record: ReferenceRecord = {
    scene,
    commit,
    // The records themselves are left out: a scene drawn before this one in the same run has just
    // rewritten its own `reference.json`, which changes no image.
    dirty:
      side.from === 'folder' &&
      git(
        'status',
        '--porcelain',
        '--untracked-files=no',
        '--',
        '.',
        ':(exclude)bench/references',
      ) !== '',
    from: side.from,
    command: `node bench/runner/references/reference.ts ${[...argv, '--scene', scene].join(' ')}`,
    generatedAt: new Date().toISOString(),
    pathVersion: options.PATH_VERSION,
    engine: settings.engine,
    settings: imageSettings(settings),
    supersampling: 0,
    approximations: [],
    views: {},
  };
  mkdirSync(join(dir, scene), { recursive: true });
  mkdirSync(join(images, scene), { recursive: true });
  try {
    const urls = { sdkUrl: options.sdkEntryUrl(side), manifestUrl: side.manifestUrl };
    const bounds = await onPage((page) => readStreet(page, urls));
    const lights = benchLights(bounds, settings);
    for (const view of views) {
      const pose = options.poseAt(bounds, options.VIEWS[view].index);
      const file = `${view}.png`;
      const payload = measurePayload(side, 0, pose, null, file, settings, lights, manifest);
      const result = await onPage((page) =>
        withGpuIncidents(page, () =>
          page.evaluate(async (o) => {
            const module = (await import(
              `${o.modulesUrl}references/referencePage.ts`
            )) as typeof ReferencePage;
            return module.referenceView(o);
          }, payload),
        ),
      );
      const capture = captures.get(file);
      if ('error' in result || !capture)
        throw new Error(`${scene} ${view}: ${'error' in result ? result.error : 'no capture'}`);
      const png = encodePng(capture.w, capture.h, capture.body, true);
      writeFileSync(join(images, scene, file), png);
      record.supersampling = result.supersampling;
      record.approximations = result.approximations;
      record.views[view] = {
        pose,
        file,
        sha256: sha256(capture.body),
        width: capture.w,
        height: capture.h,
        settleFrames: result.settleFrames,
      };
      process.stdout.write(
        `${scene} ${view}: ${capture.w}×${capture.h}, held in ${result.settleFrames} frames\n`,
      );
    }
  } finally {
    await new Promise((done) => server.close(done));
  }
  writeFileSync(join(dir, scene, 'reference.json'), JSON.stringify(record, null, 2) + '\n');
}

async function main() {
  const argv = process.argv.slice(2);
  const own = options.parseArgs(argv);
  const scenes = (own.get('scene') ?? REFERENCE_SCENES.join(',')).split(',').filter(Boolean);
  const asked = own.get('references');
  const dir = resolve(asked ?? REFERENCES_DIR),
    images = resolve(asked ?? REFERENCE_IMAGES_DIR);
  // The bench reads every other flag; these two are this command's own.
  const rest = argv.filter(
    (arg, i) =>
      !/^--(scene|references)(=|$)/.test(arg) && !/^--(scene|references)$/.test(argv[i - 1] ?? ''),
  );
  for (const scene of scenes) await referenceScene(rest, scene, dir, images);
}

await main().catch((error) => {
  process.stderr.write(String((error && error.stack) || error) + '\n');
  process.exitCode = 1;
});
