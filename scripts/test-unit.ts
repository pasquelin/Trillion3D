import { generateApiFiles } from './generate-api-reference.ts';
import { repositoryFiles } from './repository-files.ts';
import { compileSiteCaches } from './site-caches.ts';
import { isUnitTest, runUnitTests } from './unit-tests.ts';

const found = repositoryFiles();
if (!found) throw new Error('Not a Git repository.');
const files = found.filter(isUnitTest);
if (!files.length) throw new Error('No maintained unit tests found.');
await generateApiFiles();
compileSiteCaches();
// One heavy step on the machine, capped locally (`scripts/heavy-lock.ts`, `testRunFlags`).
runUnitTests(files);
