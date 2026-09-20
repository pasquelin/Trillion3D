import { join } from 'node:path';

export function proveInstalledTypes({ fixture, packageName, run, write }) {
  write(
    'common.ts',
    `import { IDENTITY_MATRIX4, multiplyMatrix4, type CameraPose, type JobSnapshot } from '${packageName}';\n` +
      `const pose:CameraPose={position:[2,1,2],target:[0,0,0],fov:55,near:.1,far:100};\n` +
      `const matrix=new Float64Array(16);multiplyMatrix4(matrix,IDENTITY_MATRIX4,IDENTITY_MATRIX4);\n` +
      `const snapshot:JobSnapshot<CameraPose>={eventVersion:1,id:'camera',status:'completed',progress:null,result:pose,error:null};\n` +
      `// @ts-expect-error Camera positions contain exactly three coordinates.\n` +
      `const invalid:CameraPose={...pose,position:[0,1]};\n` +
      `// @ts-expect-error legacy package subpaths are not public.\nimport('${packageName}/core');\n` +
      `export {matrix,snapshot,invalid};\n`,
  );
  write(
    'node.ts',
    `import { prepare, type CompilationJob, type CompilationResult, type JobSnapshot, type PrepareOptions } from '${packageName}';\n` +
      `const options:PrepareOptions={resourceBaseUrl:'/cache/'};\n` +
      `const result=prepare('scene','cache','slice',1000,options);result satisfies Promise<CompilationResult>;\n` +
      `declare const job:CompilationJob;const snapshot:JobSnapshot<CompilationResult>=job.getSnapshot();\n` +
      `// @ts-expect-error resourceBaseUrl is a URL string.\n` +
      `const invalid:PrepareOptions={resourceBaseUrl:12};\nexport {result,snapshot,invalid};\n`,
  );
  write(
    'browser.ts',
    `import { createExplorer, type CameraPose, type Explorer, type ExplorerOptions } from '${packageName}';\n` +
      `const pose:CameraPose={position:[2,1,2],target:[0,0,0],fov:55,near:.1,far:100};\n` +
      `const options:ExplorerOptions={manifestUrl:'/cache/manifest.json',pointsOfInterest:[{id:'home',label:'Home',pose}]};\n` +
      `const explorer=createExplorer('viewer',options);explorer satisfies Promise<Explorer>;\n` +
      `// @ts-expect-error unsupported cache scope.\n` +
      `const invalid:ExplorerOptions={manifestUrl:'/cache/manifest.json',scope:'preview'};\nexport {explorer,invalid};\n`,
  );
  const configurations = [
    ['common', { module: 'ESNext', moduleResolution: 'Bundler', lib: ['ES2023'], types: ['node'] }],
    [
      'node',
      { module: 'NodeNext', moduleResolution: 'NodeNext', lib: ['ES2023'], types: ['node'] },
    ],
    [
      'browser',
      {
        module: 'ESNext',
        moduleResolution: 'Bundler',
        customConditions: ['browser'],
        lib: ['ES2023', 'DOM', 'DOM.Iterable'],
        types: ['three', '@webgpu/types'],
      },
    ],
  ];
  for (const [name, options] of configurations) {
    write(
      `tsconfig-${name}.json`,
      `${JSON.stringify({ compilerOptions: { ...options, target: 'ES2023', strict: true, noEmit: true }, files: [`${name}.ts`] }, null, 2)}\n`,
    );
    run(join(fixture, 'node_modules/.bin/tsc'), ['-p', `tsconfig-${name}.json`], fixture);
  }
}
