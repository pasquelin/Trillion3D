/** The TypeScript projects of the repository, and the type check `check:changed` runs on those that
 *  own a changed file: `tsc -p <project> --noEmit` through the compiler API, so a test can check
 *  a file that is not on disk. */
import { dirname, matchesGlob, relative, resolve } from 'node:path';
import ts from 'typescript';

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

// One parse per file and language shared by every program of a run: the projects overlap, and all
// of them read the same `lib` and `@types` declarations.
const parsedFiles = new Map<string, ts.SourceFile>();

/** The program of `project`, rooted at `rootNames`; `sources` stands in for files by absolute path. */
export function projectProgram(
  project: ts.ParsedCommandLine,
  rootNames: readonly string[] = project.fileNames,
  sources: ReadonlyMap<string, string> = new Map(),
): ts.Program {
  const host = ts.createCompilerHost(project.options);
  const { fileExists, readFile } = host;
  host.fileExists = (file) => sources.has(file) || fileExists(file);
  host.readFile = (file) => sources.get(file) ?? readFile(file);
  host.getSourceFile = (file, language) => {
    const key = `${file}\0${JSON.stringify(language)}`;
    const cached = sources.has(file) ? undefined : parsedFiles.get(key);
    if (cached) return cached;
    const text = host.readFile(file);
    if (text === undefined) return undefined;
    const parsed = ts.createSourceFile(file, text, language);
    if (!sources.has(file)) parsedFiles.set(key, parsed);
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

/** Whether `project` carves `file` (absolute) out on purpose: its `include` covers it and its
 *  `exclude` takes it back, as `tsc -p` does, such as the `tests/fixtures/public*` sources a test
 *  type-checks with its own options. A file outside every `include` is never excused. */
export function excludes(project: ts.ParsedCommandLine, file: string): boolean {
  const path = relative(dirname(String(project.options.configFilePath)), file);
  const names = (specs: unknown) =>
    Array.isArray(specs) && specs.some((spec) => matchesGlob(path, String(spec)));
  return names(project.raw?.include) && names(project.raw?.exclude);
}

/**
 * The type errors of every project that owns one of `sources`, the changed TypeScript files
 * (paths relative to `root`): a project owns a file it lists, or else one its program reaches (a
 * `*.fixture.ts` a test imports). A changed file no project reaches is itself an error, never a
 * silent skip, unless a project's `include` covers it and its `exclude` takes it back.
 */
export function changedTypeErrors(
  root: string,
  projects: readonly string[],
  sources: readonly string[],
): string[] {
  if (!sources.length) return [];
  const parsed = projects.map((project) => parseProject(resolve(root, project)));
  const listed = new Map(parsed.map((project) => [project, new Set(project.fileNames)]));
  const programs = new Map<ts.ParsedCommandLine, ts.Program>();
  const programOf = (project: ts.ParsedCommandLine) => {
    const program = programs.get(project) ?? projectProgram(project);
    programs.set(project, program);
    return program;
  };
  const errors: string[] = [];
  const owners = new Set<ts.ParsedCommandLine>();
  for (const source of sources) {
    const file = resolve(root, source);
    const listing = parsed.filter((project) => listed.get(project)!.has(file));
    const found = listing.length
      ? listing
      : parsed.filter((project) => programOf(project).getSourceFile(file));
    if (!found.length && !parsed.some((project) => excludes(project, file)))
      errors.push(`${source}: no tsconfig project type-checks it (${projects.join(', ')}).`);
    for (const project of found) owners.add(project);
  }
  for (const project of owners) errors.push(...typeErrors(programOf(project), root));
  return errors;
}
