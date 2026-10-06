// Generic hook: only hands over to the tool-installed hook of the same name, given first.
// `.githooks/post-commit` and `.githooks/post-checkout` are symbolic links to its shim.
import { runLocalHook } from './lib.ts'

const [name = '', ...args] = process.argv.slice(2)
runLocalHook(name, args)
