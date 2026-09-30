import { spawnSync } from 'node:child_process';
import { heavyStep } from './heavy-lock.ts';

// `node scripts/heavy-step.ts <step> <command> [argument...]` runs one command as a heavy step:
// alone among the worktrees of the machine and at low priority, locally (`scripts/heavy-lock.ts`).
const [step, command, ...args] = process.argv.slice(2);
if (!step || !command)
  throw new Error('Usage: node scripts/heavy-step.ts <step> <command> [arg...]');
const result = heavyStep(step, () => spawnSync(command, args, { stdio: 'inherit' }));
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
