// The API reference of the portal, generated from the TypeScript declarations of the three public
// entries (`site/content/reference/api.json`): one entry per export, per family member and per
// member of the world, each with its signature and the TSDoc its source carries. `--check` fails
// when the committed file is stale. The French text lives beside it, in `api.fr.json`.
import { FAMILIES } from '../site/content/model.ts';
import { buildReference } from './api-reference/exports.ts';
import { writeGenerated } from './sdk-api-model.ts';

await writeGenerated(
  'site/content/reference/api.json',
  `${JSON.stringify(buildReference(new Set(FAMILIES)), null, 2)}\n`,
);
