import { heavyStep } from './heavy-lock.ts'
import { run } from '../test/run.ts'

// `node scripts/native/heavy-step.ts <step> <command> [argument...]` runs one command as a heavy step:
// alone among the worktrees of the machine and at low priority, locally (`scripts/native/heavy-lock.ts`).
const [step, command, ...args] = process.argv.slice(2)
if (!step || !command)
  throw new Error('Usage: node scripts/heavy-step.ts <step> <command> [arg...]')
heavyStep(step, () => run(command, args))
