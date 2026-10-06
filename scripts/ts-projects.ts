/** The TypeScript projects of the repository, and the type check `check:changed` runs on those that
 *  own a changed file: `tsc -p <project> --noEmit` through the compiler API, so a test can check
 *  a file that is not on disk. */
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import { outDir } from './engine-dist.ts';

/** Every tracked `tsconfig*.json` of `files`: the projects the gates type-check. */
export function tsProjects(files: readonly string[]): string[] {
  return files.filter((file) => /(?:^|\/)tsconfig(?:\.[\w-]+)?\.json$/.test(file));
}

/** `config` read as `tsc -p` reads it; an unreadable one stops the run. */
export function parseProject(config: string): ts.ParsedCommandLine {
  const fail = (diagnostic: ts.Diagnostic) => {
    throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
  };
  const parsed = ts.getParsedCommandLineOfConfigFile(
    config,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: fail,
    },
  );
  // Undefined only after `fail` has thrown.
  if (parsed!.errors.length) fail(parsed!.errors[0]!);
  return parsed!;
}

/** The program of `project`, rooted at `rootNames`; `sources` stands in for files by absolute path.
 *  `parses` shares one parse per file and language across the programs of a run (the projects
 *  overlap and all read the same `lib` and `@types` declarations); a parse is reused only while its
 *  file still reads the same, so a rebuilt `dist/` is parsed again. */
export function projectProgram(
  project: ts.ParsedCommandLine,
  rootNames: readonly string[] = project.fileNames,
  sources: ReadonlyMap<string, string> = new Map(),
  parses: Map<string, ts.SourceFile> = new Map(),
): ts.Program {
  const host = ts.createCompilerHost(project.options);
  const { fileExists, readFile } = host;
  host.fileExists = (file) => sources.has(file) || fileExists(file);
  host.readFile = (file) => sources.get(file) ?? readFile(file);
  host.getSourceFile = (file, language) => {
    const text = host.readFile(file);
    if (text === undefined) return undefined;
    const key = `${file}\0${JSON.stringify(language)}`;
    const cached = parses.get(key);
    if (cached?.text === text) return cached;
    const parsed = ts.createSourceFile(file, text, language);
    parses.set(key, parsed);
    return parsed;
  };
  return ts.createProgram({ rootNames, options: project.options, host });
}

/** The errors `tsc --noEmit` reports on `program`, one formatted line each. */
export function typeErrors(program: ts.Program, root: string): string[] {
  const host: ts.FormatDiagnosticsHost = {
    getCanonicalFileName: (file) => file,
    getCurrentDirectory: () => root,
    getNewLine: () => '\n',
  };
  return ts.getPreEmitDiagnostics(program).map((d) => ts.formatDiagnostics([d], host).trim());
}

/** Whether `project`, a type-check-only (`noEmit`) project, carves `file` (absolute) out on purpose:
 *  its `include` covers it and its `exclude` takes it back, such as the `tests/fixtures/public/`
 *  sources a test type-checks with its own options. An emitting project's `exclude` only says what
 *  not to emit. TypeScript expands the `include` itself, so the globs mean what they mean to `tsc`. */
export function excludes(project: ts.ParsedCommandLine, file: string): boolean {
  if (!project.options.noEmit) return false;
  const base = dirname(String(project.options.configFilePath));
  const included = ts.parseJsonConfigFileContent({ ...project.raw, exclude: [] }, ts.sys, base);
  return included.fileNames.includes(file) && !project.fileNames.includes(file);
}

/** Whether `project` reads the `trillion3d` package from the build output, as the site and the
 *  tools do (`package.json` `exports`): checked against a missing or stale build, it would report
 *  the wrong errors. The package resolving under `dist/`, or not at all (a missing or half-removed
 *  build), means it does; the SDK's own projects map it back to their sources. */
export function readsDist(project: ts.ParsedCommandLine): boolean {
  const importer = resolve(dirname(String(project.options.configFilePath)), 'index.ts');
  const { resolvedModule } = ts.resolveModuleName('trillion3d', importer, project.options, ts.sys);
  return !resolvedModule || resolvedModule.resolvedFileName.startsWith(`${outDir}/`);
}

/**
 * The type errors of every project that owns one of `sources`, the changed TypeScript files
 * (paths relative to `root`): a project owns a file it lists, or else one its program reaches (a
 * `*.fixture.ts` a test imports). A changed file no project reaches is itself an error, never a
 * silent skip, unless a `noEmit` project's `include` covers it and its `exclude` takes it back. When an
 * owner reads `trillion3d` from `dist/`, `build` runs first, so the check reads current declarations.
 */
export function changedTypeErrors(
  root: string,
  projects: readonly string[],
  sources: readonly string[],
  build: () => void,
): string[] {
  if (!sources.length) return [];
  const parsed = projects.map((project) => parseProject(resolve(root, project)));
  const parses = new Map<string, ts.SourceFile>();
  const programs = new Map<ts.ParsedCommandLine, ts.Program>();
  const programOf = (project: ts.ParsedCommandLine) => {
    const program = programs.get(project) ?? projectProgram(project, undefined, undefined, parses);
    programs.set(project, program);
    return program;
  };
  const errors: string[] = [];
  const owners = new Set<ts.ParsedCommandLine>();
  for (const source of sources) {
    const file = resolve(root, source);
    const listing = parsed.filter((project) => project.fileNames.includes(file));
    const found = listing.length
      ? listing
      : parsed.filter((project) => programOf(project).getSourceFile(file));
    if (!found.length && !parsed.some((project) => excludes(project, file)))
      errors.push(`${source}: no tsconfig project type-checks it (${projects.join(', ')}).`);
    for (const project of found) owners.add(project);
  }
  const readers = [...owners].filter(readsDist);
  if (readers.length) {
    build();
    for (const project of readers) programs.delete(project);
  }
  for (const project of owners) {
    errors.push(...typeErrors(programOf(project), root));
    programs.delete(project);
  }
  return errors;
}
