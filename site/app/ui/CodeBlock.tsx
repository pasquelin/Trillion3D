import { useMemo } from 'react';
import { highlightLines } from './highlightLines.ts';
import { CodeSurface } from './CodeSurface.tsx';
import type { CodeLanguage } from './highlighter.ts';
import type { Locale } from '../../content/locale.ts';

interface CodeBlockProps {
  code: string;
  locale?: Locale;
  label?: string;
  language?: CodeLanguage;
}

export function CodeBlock({ code, locale = 'en', label, language }: CodeBlockProps) {
  const title = label ?? (locale === 'fr' ? 'Code exécutable' : 'Runnable code');
  const lines = useMemo(() => highlightLines(code, language), [code, language]);
  return (
    <CodeSurface code={code} locale={locale} title={title}>
      <div className="code-scroll" tabIndex={0} role="region" aria-label={title}>
        <div className="code-lines">
          {lines.map((line: string, index: number) => (
            <pre key={index} data-prefix={index + 1}>
              <code dangerouslySetInnerHTML={{ __html: line }} />
            </pre>
          ))}
        </div>
      </div>
    </CodeSurface>
  );
}
