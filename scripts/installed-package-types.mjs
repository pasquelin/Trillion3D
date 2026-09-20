import { join } from 'node:path';

export function proveInstalledTypes({ fixture, core, node, browser, run, write }) {
  write(
    'common.ts',
    `import { IDENTITY_MATRIX4, multiplyMatrix4, type CameraPose, type JobSnapshot } from '${core}';\n` +
      `const pose:CameraPose={position:[2,1,2],target:[0,0,0],fov:55,near:.1,far:100};\n` +
      `const matrix=new Float64Array(16);multiplyMatrix4(matrix,IDENTITY_MATRIX4,IDENTITY_MATRIX4);\n` +
      `const snapshot:JobSnapshot<CameraPose>={eventVersion:1,id:'camera',status:'completed',progress:null,result:pose,error:null};\n` +
      `// @ts-expect-error Camera positions contain exactly three coordinates.\n` +
      `const invalid:CameraPose={...pose,position:[0,1]};\nexport {matrix,snapshot,invalid};\n`,
  );
  write(
    'node.ts',
    `import { type JobSnapshot } from '${core}';\n` +
      `import { prepare, type CompilationJob, type CompilationResult, type PrepareOptions } from '${node}';\n` +
      `const options:PrepareOptions={resourceBaseUrl:'/cache/'};\n` +
      `const result:Promise<CompilationResult>=prepare('scene','cache','slice',1000,options);\n` +
      `declare const job:CompilationJob;const snapshot:JobSnapshot<CompilationResult>=job.getSnapshot();\n` +
      `// @ts-expect-error resourceBaseUrl is a URL string.\n` +
      `const invalid:PrepareOptions={resourceBaseUrl:12};\nexport {result,snapshot,invalid};\n`,
  );
  write(
    'browser.ts',
    `import { createExplorer, type CameraPose, type Explorer, type ExplorerOptions } from '${browser}';\n` +
      `const pose:CameraPose={position:[2,1,2],target:[0,0,0],fov:55,near:.1,far:100};\n` +
      `const options:ExplorerOptions={manifestUrl:'/cache/manifest.json',pointsOfInterest:[{id:'home',label:'Home',pose}]};\n` +
      `const explorer:Promise<Explorer>=createExplorer('viewer',options);\n` +
      `// @ts-expect-error unsupported cache scope.\n` +
      `const invalid:ExplorerOptions={manifestUrl:'/cache/manifest.json',scope:'preview'};\nexport {explorer,invalid};\n`,
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
