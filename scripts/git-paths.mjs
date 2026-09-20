import { spawn } from 'node:child_process';

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
