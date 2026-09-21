import { useEffect, useRef } from 'react';
import type { Locale } from '../../content/locale.ts';
import type { DiagnosticMode } from '../../lessons/engine-scene/diagnosticModes.ts';
import { CodeBlock } from '../components/CodeBlock.tsx';
import { LessonTemplate } from '../components/LessonTemplate.tsx';
import { engineExampleCode } from '../../lessons/engine-scene/code.ts';
import { sceneCopy } from '../../lessons/engine-scene/content.ts';
import { mountScene } from '../../lessons/engine-scene/lifecycle.ts';
import { EnginePreview, engineCopy } from './EnginePreview.tsx';
import { SceneControls } from './SceneControls.tsx';
import { EngineStats } from './Stats.tsx';
import { EngineGuide } from './Guide.tsx';

interface EngineExampleProps {
  locale?: Locale;
  diagnostic?: DiagnosticMode;
  code?: string;
}

export function EngineExample({
  locale = 'en',
  diagnostic = 'beauty',
  code = engineExampleCode,
}: EngineExampleProps) {
  const host = useRef<HTMLDivElement>(null);
  const copy = engineCopy(locale);
  useEffect(() => {
    if (host.current) {
      return mountScene(host.current, sceneCopy[locale], locale);
    }
  }, [locale, diagnostic]);
  return (
    <div ref={host} data-engine-lesson>
      <LessonTemplate
        title={copy.title}
        description={copy.intro}
        controls={<SceneControls copy={copy} diagnostic={diagnostic} />}

        code={<CodeBlock code={code} locale={locale} label={copy.code} />}
        viewport={<EnginePreview locale={locale} />}
        note={
          <>
            <EngineStats copy={copy} />
            <EngineGuide copy={copy} locale={locale} diagnostic={diagnostic} />
          </>
        }
      />
    </div>
  );
}

export function EngineScene({ locale = 'en' }: { locale?: Locale }) {
  return <EngineExample locale={locale} />;
}
