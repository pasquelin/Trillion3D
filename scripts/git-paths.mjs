import { execFileSync, spawn } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Synchronous configuration readers keep their contract without buffering child stdout. */
export function gitPathsSync(args, cwd = process.cwd()) {
  const directory = mkdtempSync(join(tmpdir(), 'geometry-git-output-'));
  let descriptor;
  try {
    const output = join(directory, 'paths');
    descriptor = openSync(output, 'w');
    execFileSync('git', args, { cwd, stdio: ['ignore', descriptor, 'inherit'] });
    return readFileSync(output, 'utf8').split('\0').filter(Boolean);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Read NUL-separated paths without the synchronous child's output-buffer limit. */
export async function gitPaths(args, cwd = process.cwd()) {
  const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'inherit'] });
  const completion = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`git exited with ${code ?? signal}`));
    });
  });
  const paths = [];
  const output = (async () => {
    child.stdout.setEncoding('utf8');
    let pending = '';
    for await (const chunk of child.stdout) {
      const entries = (pending + chunk).split('\0');
      pending = entries.pop();
      paths.push(...entries.filter(Boolean));
    }
    if (pending) paths.push(pending);
  })();
  await Promise.all([completion, output]);
  return paths;
}
