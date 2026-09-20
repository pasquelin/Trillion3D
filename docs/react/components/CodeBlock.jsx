import { useMemo } from 'react';
import { highlightLines } from '../../js/components/highlightLines.js';
import { CodeSurface } from './CodeSurface.jsx';

export function CodeBlock({ code, locale = 'en', label }) {
  const title = label ?? (locale === 'fr' ? 'Code exécutable' : 'Runnable code');
  const lines = useMemo(() => highlightLines(code), [code]);
  return (
    <CodeSurface code={code} locale={locale} title={title}>
      <div className="code-scroll" tabIndex={0} role="region" aria-label={title}>
        <div className="code-lines">
          {lines.map((line, index) => (
            <pre key={index} data-prefix={index + 1}>
              <code dangerouslySetInnerHTML={{ __html: line }} />
            </pre>
          ))}
        </div>
      </div>
    </CodeSurface>
  );
}
