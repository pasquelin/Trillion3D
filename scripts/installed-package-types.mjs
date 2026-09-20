import { join } from 'node:path';

export function proveInstalledTypes({ fixture, core, node, browser, run, write }) {
  write(
    'common.ts',
    `import { hierarchyUpdateBatch } from '${core}';\nvoid hierarchyUpdateBatch;\n`,
  );
  write(
    'node.ts',
    `import { hierarchyUpdateBatch } from '${core}';\nimport { prepare } from '${node}';\nvoid hierarchyUpdateBatch;void prepare;\n`,
  );
  write(
    'browser.ts',
    `import { createExplorer, hierarchyUpdateBatch } from '${browser}';\nvoid createExplorer;void hierarchyUpdateBatch;\n`,
  );
  const configurations = [
    [
      'common',
      { module: 'NodeNext', moduleResolution: 'NodeNext', lib: ['ES2023'], types: ['node'] },
    ],
    [
      'node',
      { module: 'NodeNext', moduleResolution: 'NodeNext', lib: ['ES2023'], types: ['node'] },
    ],
    [
      'browser',
      {
        module: 'ESNext',
        moduleResolution: 'Bundler',
        lib: ['ES2023', 'DOM', 'DOM.Iterable'],
        types: ['three', '@webgpu/types'],
      },
    ],
  ];
  for (const [name, options] of configurations) {
    write(
      `tsconfig-${name}.json`,
      `${JSON.stringify({ compilerOptions: { ...options, strict: true, noEmit: true }, files: [`${name}.ts`] }, null, 2)}\n`,
    );
    run(join(fixture, 'node_modules/.bin/tsc'), ['-p', `tsconfig-${name}.json`], fixture);
  }
}
