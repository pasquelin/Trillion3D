import { useState } from 'react';
import { useWords } from '../i18n.ts';
import type { ReactNode } from 'react';
import type { Locale } from '../../content/locale.ts';
import { Button } from './Button.tsx';

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
  const t = useWords(locale);
  async function copy() {
    try {
      await navigator.clipboard.writeText(String(code));
      setStatus(t('code.copied'));
    } catch {
      setStatus(t('code.copyFailed'));
    }
  }
  return (
    <section data-code-block>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
        <span className="text-sm font-semibold">{title}</span>
        <div className="flex flex-wrap gap-2">
          {actions}
          <Button size="sm" onClick={copy}>
            {t('code.copy')}
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
