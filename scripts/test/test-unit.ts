import { repositoryFiles } from '../git/repository-files.ts'
import { compileCaches } from '../native/scene-caches.ts'
import { isUnitTest, runUnitTests } from './unit-tests.ts'

const found = repositoryFiles()
if (!found) throw new Error('Not a Git repository.')
const files = found.filter(isUnitTest)
if (!files.length) throw new Error('No maintained unit tests found.')
compileCaches()
// One heavy step on the machine, capped locally (`scripts/native/heavy-lock.ts`, `testRunFlags`).
runUnitTests(files)
