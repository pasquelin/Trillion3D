import { useState } from 'react';
import type { ReactNode } from 'react';
import type { Locale } from '../types/portal.ts';
import { Button } from './UI.tsx';

/** Shared code chrome for both read-only snippets and the editable code primitive. */
interface CodeSurfaceProps {
  code: string;
  locale: Locale;
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}

export function CodeSurface({ code, locale, title, actions, children }: CodeSurfaceProps) {
  const [status, setStatus] = useState('');
  const french = locale === 'fr';
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
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
        <span className="text-sm font-semibold">{title}</span>
        <div className="flex flex-wrap gap-2">
          {actions}
          <Button size="sm" onClick={copy}>
            {french ? 'Copier le code' : 'Copy code'}
          </Button>
        </div>
      </div>
      <div className="mockup-code w-full">{children}</div>
      <span className="text-sm" role="status">
        {status}
      </span>
    </section>
  );
}
