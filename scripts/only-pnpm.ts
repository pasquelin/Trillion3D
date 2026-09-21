// The repo installs with pnpm, and with it alone.
//
// Nothing prevented `npm install`: it placed a `package-lock.json` and flat `node_modules`
// next to pnpm's, and the two diverged silently. This guardrail rejects it on installation
// rather than letting divergence be discovered in continuous integration — or worse, on a benchmark
// verdict rendered with different versions than those in the lockfile.
//
// `npm_config_user_agent` is set by any package manager launching a lifecycle script; it
// starts with its name. If absent, nobody ran us from an install: we allow it.
import { pathToFileURL } from 'node:url';
//
// The guardrail runs ONLY when this file is the launched program (`preinstall`): repo scripts
// import it for `pnpmCommand`, and an import should not decide their fate.
const agent = process.env.npm_config_user_agent ?? '';
const lance = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (lance && agent && !agent.startsWith('pnpm')) {
  const nom = agent.split('/')[0];
  console.error(
    `\nThis repository installs with pnpm, not with ${nom}.\n` +
      `  corepack enable && pnpm install\n\n` +
      `The tracked lockfile is pnpm-lock.yaml; there is no package-lock.json, and the manager\n` +
      `version is pinned by the "packageManager" field of package.json.\n`,
  );
  process.exit(1);
}

/** The command that re-invokes the repo's package manager. `npm_execpath` is the path of the manager
 *  that launched us: running it with current Node avoids the Windows `pnpm.cmd` case, where a
 *  script without extension does not execute — and guarantees it is indeed the manager that placed
 *  `node_modules` doing the build. Outside a lifecycle script, we name `pnpm` and rely on the
 *  PATH. Exported here because this file already states which package manager the repo wants. */
export function pnpmCommand(...args: string[]): [string, string[]] {
  const execpath = process.env.npm_execpath;
  if (execpath) return [process.execPath, [execpath, ...args]];
  return [process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args];
}
