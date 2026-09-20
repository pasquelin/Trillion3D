import { useMemo, useState } from 'react';
import { highlightLines } from '../../js/components/highlightLines.js';

export function CodeBlock({ code, locale = 'en', label }) {
  const french = locale === 'fr';
  const title = label ?? (french ? 'Code exécutable' : 'Runnable code');
  const lines = useMemo(() => highlightLines(code), [code]);
  const [status, setStatus] = useState('');
  async function copy() {
    try {
      await navigator.clipboard.writeText(String(code));
      setStatus(french ? 'Copié' : 'Copied');
    } catch {
      setStatus(french ? 'Échec de la copie' : 'Copy failed');
    }
  }
  return (
    <section data-code-block>
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className="text-sm font-semibold">{title}</span>
        <button type="button" className="btn btn-sm btn-ghost" onClick={copy}>
          {french ? 'Copier le code' : 'Copy code'}
        </button>
      </div>
      <div className="mockup-code w-full">
        <div className="code-scroll" tabIndex={0} role="region" aria-label={title}>
          <div className="code-lines">
            {lines.map((line, index) => (
              <pre key={index} data-prefix={index + 1}>
                <code dangerouslySetInnerHTML={{ __html: line }} />
              </pre>
            ))}
          </div>
        </div>
      </div>
      <span className="text-sm" role="status">
        {status}
      </span>
    </section>
  );
}
