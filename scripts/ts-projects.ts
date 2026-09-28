/** The TypeScript projects of the repository, and the type check `check:changed` runs on those that
 *  own a changed file: `tsc -p <project> --noEmit` through the compiler API, so a test can check
 *  a file that is not on disk. */
import { resolve } from 'node:path';
import ts from 'typescript';

const TS_SOURCE = /\.(?:[cm]?ts|tsx)$/;

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
  if (!parsed) throw new Error(`${config}: not a TypeScript project.`);
  if (parsed.errors.length) fail(parsed.errors[0]!);
  return parsed;
}

/** The program of `project`, rooted at `rootNames`; `sources` stands in for files by absolute path. */
export function projectProgram(
  project: ts.ParsedCommandLine,
  rootNames: readonly string[] = project.fileNames,
  sources: ReadonlyMap<string, string> = new Map(),
): ts.Program {
  const host = ts.createCompilerHost(project.options);
  if (!sources.size) return ts.createProgram({ rootNames, options: project.options, host });
  const { fileExists, readFile } = host;
  host.fileExists = (file) => sources.has(file) || fileExists(file);
  host.readFile = (file) => sources.get(file) ?? readFile(file);
  host.getSourceFile = (file, language) => {
    const text = host.readFile(file);
    return text === undefined ? undefined : ts.createSourceFile(file, text, language);
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

/**
 * The type errors of every project that owns one of `changed` (paths relative to `root`): a project
 * owns a file it lists, or else one its program reaches (a `*.fixture.ts` a test imports). A
 * changed TypeScript file no project reaches is itself an error, never a silent skip.
 */
export function changedTypeErrors(
  root: string,
  projects: readonly string[],
  changed: readonly string[],
): string[] {
  const sources = changed.filter((file) => TS_SOURCE.test(file));
  if (!sources.length) return [];
  const parsed = projects.map((project) => parseProject(resolve(root, project)));
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
    const listing = parsed.filter((project) => project.fileNames.includes(file));
    const found = listing.length
      ? listing
      : parsed.filter((project) => programOf(project).getSourceFile(file));
    if (!found.length)
      errors.push(`${source}: no tsconfig project type-checks it (${projects.join(', ')}).`);
    for (const project of found) owners.add(project);
  }
  for (const project of owners) errors.push(...typeErrors(programOf(project), root));
  return errors;
}
