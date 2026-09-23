import { Fragment, useMemo } from 'react';
import { highlightLines } from './highlightLines.ts';
import { CodeSurface } from './CodeSurface.tsx';
import type { CodeLanguage } from './highlighter.ts';
import type { Locale } from '../../content/locale.ts';

interface CodeBlockProps {
  code: string;
  locale?: Locale;
  label?: string;
  language?: CodeLanguage;
  /** Blank rows shown after some lines (line index → rows), never copied: aligns two blocks. */
  gaps?: ReadonlyMap<number, number>;
  /** The whole program at its own height, the page scrolling it, instead of an inner region. */
  whole?: boolean;
}

export function CodeBlock({ code, locale = 'en', label, language, gaps, whole }: CodeBlockProps) {
  const title = label ?? (locale === 'fr' ? 'Code exécutable' : 'Runnable code');
  const lines = useMemo(() => highlightLines(code, language), [code, language]);
  return (
    <CodeSurface code={code} locale={locale} title={title}>
      <div
        className="code-scroll"
        style={whole ? { maxHeight: 'none' } : undefined}
        tabIndex={0}
        role="region"
        aria-label={title}
      >
        <div className="code-lines">
          {lines.map((line: string, index: number) => (
            <Fragment key={index}>
              <pre data-prefix={index + 1}>
                <code dangerouslySetInnerHTML={{ __html: line }} />
              </pre>
              {Array.from({ length: gaps?.get(index) ?? 0 }, (_, row) => (
                <pre key={row} data-prefix="" aria-hidden="true">
                  <code> </code>
                </pre>
              ))}
            </Fragment>
          ))}
        </div>
      </div>
    </CodeSurface>
  );
}
