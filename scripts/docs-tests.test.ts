import test from 'node:test';
import assert from 'node:assert/strict';
import { documentationTests, documentReads } from './docs-tests.ts';
import { repositoryFiles } from './repository-files.ts';

test('a string naming documentation is a read; a comment or a code import is not', () => {
  const source = `// docs/REFERENCE.md in a comment
import words from '../site/i18n/en.json' with { type: 'json' };
import { links } from './docs/render.ts';
const page = readFileSync(\`\${root}/docs/TESTS.md\`);
const notices = 'THIRD_PARTY_NOTICES.md';`;
  assert.deepEqual(documentReads('a.test.ts', source), ['../site/i18n/en.json', '/docs/TESTS.md']);
});

test('a test reading documentation itself or through a script it imports is found; the engine is not followed', () => {
  const files: Record<string, string> = {
    'scripts/a.test.ts': `readFileSync('docs/REFERENCE.md');`,
    'scripts/b.test.ts': `import { pages } from './pages.ts';`,
    'scripts/pages.ts': `export const pages = () => readdirSync('site/assets/examples/thumbnails');`,
    'scripts/c.test.ts': `import { draw } from '../packages/sdk-core/src/draw.ts';`,
    'packages/sdk-core/src/draw.ts': `export const draw = () => 'docs/SDK.md';`,
    'scripts/pages.fixture.md': '',
  };
  const paths = Object.keys(files);
  assert.deepEqual(
    documentationTests(paths, (file) => files[file]),
    ['scripts/a.test.ts', 'scripts/b.test.ts'],
  );
});

test('the tests that read documentation in the repository are the set a documentation change runs', () => {
  // The guard of #1348: each reads docs/, a Markdown page, a translation, the thumbnails or the
  // pull request template, and a documentation-only pull request must still run it.
  const found = documentationTests(repositoryFiles() ?? []);
  for (const reader of [
    'tests/integration/reference.test.ts',
    'scripts/tests-inventory.test.ts',
    'scripts/check-pr-body.test.ts',
    'scripts/docs-examples.test.ts',
    'scripts/docs-i18n.test.ts',
    'scripts/docs-examples-words.test.ts',
    'scripts/check-thumbnails.test.ts',
    'site/examples/kit/banner.test.ts',
    'bench/runner/publishReport.test.ts',
  ])
    assert.ok(found.includes(reader), reader);
  assert.ok(!found.includes('tests/integration/public-package-root.test.ts'), 'reads the notices');
});
