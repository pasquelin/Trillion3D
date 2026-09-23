// Fails when a language's keys differ from English's, naming each missing and extra key
// (`scripts/i18n-keys.ts`): `pnpm run check:i18n`, in the `quick` group of `validate`.
import { describeMismatches, keyMismatches } from './i18n-keys.ts';

const mismatches = keyMismatches();
if (mismatches.length) {
  console.error(describeMismatches(mismatches));
  process.exit(1);
}
console.log('Every language gives exactly the keys English gives.');
