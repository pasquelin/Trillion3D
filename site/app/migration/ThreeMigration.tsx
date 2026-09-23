import { DocPage } from '../layout/DocPage.tsx';
import { CodeBlock } from '../ui/CodeBlock.tsx';
import { Inline } from '../ui/Prose.tsx';
import { Split } from '../ui/Split.tsx';
import { sectionGaps } from '../ui/sectionGaps.ts';
import threeProgram from '../../content/migration/three-scene.txt';
import engineProgram from '../../examples/migrating-from-three.html';
import type { Locale } from '../../content/locale.ts';
import type { PortalEntry } from '../../content/model.ts';

const [threeGaps, engineGaps] = sectionGaps(threeProgram, engineProgram);

/**
 * The migration guide: one Three.js program (text, never run) beside the engine program that
 * draws the same scene, section by section — each `// --- <name>` header on the same row.
 */
export function ThreeMigration({ entry, locale }: { entry: PortalEntry; locale: Locale }) {
  return (
    <DocPage title={entry.title} lead={<Inline text={entry.description} />}>
      <Split
        read={
          <CodeBlock
            code={threeProgram}
            locale={locale}
            label="Three.js r174"
            language="html"
            gaps={threeGaps}
            whole
          />
        }
        observe={
          <CodeBlock
            code={engineProgram}
            locale={locale}
            label="trillion3D · examples/migrating-from-three.html"
            language="html"
            gaps={engineGaps}
            whole
          />
        }
      />
    </DocPage>
  );
}
