import type { Metafile } from 'esbuild';

/** Runs a command synchronously with UTF-8 output, returning stdout; shared by every
 * installed-package proof so each one does not respawn its own child process helper. */
export type Run = (
  command: string,
  args: string[],
  cwd?: string,
  environment?: NodeJS.ProcessEnv,
) => string;

/** Writes a fixture file by name, relative to the proof's temporary root. */
export type Write = (name: string, value: string) => void;

/** Bundles a fixture module with esbuild and returns its metafile. */
export type Bundle = (
  name: string,
  source: string,
  platform?: string,
  conditions?: string[] | null,
) => Metafile;
