import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import ts from 'typescript';

const ROOT = resolve(import.meta.dirname, '../..');

function diagnostics(file, options) {
  const program = ts.createProgram([isAbsolute(file) ? file : resolve(ROOT, file)], {
    target: ts.ScriptTarget.ES2022,
    strict: true,
    skipLibCheck: false,
    noEmit: true,
    ...options,
  });
  return ts
    .getPreEmitDiagnostics(program)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
}

test('package metadata exposes one environment-aware root', async () => {
  const packageJson = JSON.parse(await readFile(resolve(ROOT, 'package.json')));
  assert.equal(packageJson.name, 'web-geometry');
  assert.equal(packageJson.version, '0.2.0');
  assert.equal(packageJson.private, true);
  assert.equal(packageJson.bin['web-geometry-compile'], './dist/sdk-node/cli.mjs');
  assert.deepEqual(Object.keys(packageJson.exports), ['.', './package.json']);
  assert.deepEqual(Object.keys(packageJson.exports['.']), [
    'browser',
    'node',
    'types',
    'import',
    'default',
  ]);
  assert.equal(packageJson.exports['.'].default, './dist/sdk/index.js');
  assert.equal(packageJson.peerDependencies.three, '^0.174.0');
  assert.equal(packageJson.scripts.preinstall, undefined);
});

test('NodeNext, browser Bundler, and the safe default resolve matching declarations', () => {
  assert.deepEqual(
    diagnostics('test/fixtures/publicNode.mts', {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      types: ['node'],
    }),
    [],
  );
  assert.deepEqual(
    diagnostics('test/fixtures/publicBrowser.ts', {
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      customConditions: ['browser'],
      lib: ['lib.es2023.d.ts', 'lib.dom.d.ts'],
      types: ['@webgpu/types'],
    }),
    [],
  );
  assert.deepEqual(
    diagnostics('test/fixtures/publicCommon.ts', {
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      lib: ['lib.es2023.d.ts'],
      types: ['node'],
    }),
    [],
  );
});

test('type-only imports leave no runtime package import', async () => {
  const source = await readFile(resolve(ROOT, 'test/fixtures/publicTypesOnly.ts'), 'utf8');
  const emitted = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  assert.doesNotMatch(emitted, /web-geometry/);
});

test('the browser condition imports rendering and common bindings without initialization', () => {
  const probe = `
    const sdk = await import('web-geometry');
    if (typeof sdk.createExplorer !== 'function') throw new Error('missing createExplorer');
    if (typeof sdk.hierarchyUpdateBatch !== 'function') throw new Error('missing common maths');
    if ('prepare' in sdk) throw new Error('Node API leaked into browser');
  `;
  execFileSync(process.execPath, ['--conditions=browser', '--input-type=module', '-e', probe], {
    cwd: ROOT,
    stdio: 'pipe',
  });
});

test('a packed installation resolves Node and browser runtime and declarations', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'web-geometry-contract-'));
  try {
    execFileSync('pnpm', ['pack', '--pack-destination', directory], {
      cwd: ROOT,
      env: { ...process.env, CI: 'true' },
      stdio: 'pipe',
    });
    const tarball = (await readdir(directory)).find((file) => file.endsWith('.tgz'));
    assert.ok(tarball);
    await writeFile(
      join(directory, 'package.json'),
      JSON.stringify({
        private: true,
        type: 'module',
        dependencies: {
          meshoptimizer: `link:${resolve(ROOT, 'node_modules/meshoptimizer')}`,
          'web-geometry': `file:${join(directory, tarball)}`,
          three: `file:${resolve(ROOT, 'node_modules/three')}`,
        },
        devDependencies: {
          '@types/three': `link:${resolve(ROOT, 'node_modules/@types/three')}`,
          '@webgpu/types': `link:${resolve(ROOT, 'node_modules/@webgpu/types')}`,
        },
      }),
    );
    await writeFile(
      join(directory, 'pnpm-workspace.yaml'),
      `packages: []\noverrides:\n  meshoptimizer: link:${resolve(ROOT, 'node_modules/meshoptimizer')}\n`,
    );
    execFileSync('pnpm', ['install', '--offline', '--config.auto-install-peers=false'], {
      cwd: directory,
      stdio: 'pipe',
    });
    await writeFile(
      join(directory, 'node.mjs'),
      "import {prepare,hierarchyUpdateBatch} from 'web-geometry'; if (!prepare || !hierarchyUpdateBatch) throw Error('node');",
    );
    await writeFile(
      join(directory, 'browser.mjs'),
      "import {createExplorer,hierarchyUpdateBatch} from 'web-geometry'; if (!createExplorer || !hierarchyUpdateBatch) throw Error('browser');",
    );
    execFileSync(process.execPath, ['node.mjs'], { cwd: directory, stdio: 'pipe' });
    execFileSync(process.execPath, ['--conditions=browser', 'browser.mjs'], {
      cwd: directory,
      stdio: 'pipe',
    });
    await writeFile(
      join(directory, 'node.mts'),
      await readFile(resolve(ROOT, 'test/fixtures/publicNode.mts')),
    );
    await writeFile(
      join(directory, 'browser.ts'),
      await readFile(resolve(ROOT, 'test/fixtures/publicBrowser.ts')),
    );
    await writeFile(
      join(directory, 'common.ts'),
      await readFile(resolve(ROOT, 'test/fixtures/publicCommon.ts')),
    );
    assert.deepEqual(
      diagnostics(join(directory, 'node.mts'), {
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        types: ['node'],
      }),
      [],
    );
    assert.deepEqual(
      diagnostics(join(directory, 'browser.ts'), {
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        customConditions: ['browser'],
        lib: ['lib.es2023.d.ts', 'lib.dom.d.ts'],
        types: ['@webgpu/types'],
      }),
      [],
    );
    assert.deepEqual(
      diagnostics(join(directory, 'common.ts'), {
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        lib: ['lib.es2023.d.ts'],
        types: ['node'],
      }),
      [],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
