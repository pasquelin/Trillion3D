import type { KeyboardEvent } from 'react';
import { t } from '../../content/i18n/index.ts';
import { Button } from '../ui/Button.tsx';
import { CodeInput } from '../ui/CodeInput.tsx';
import { CodeSurface } from '../ui/CodeSurface.tsx';
import { usePortal } from './PortalContext.ts';

interface CodePanelProps {
  file: string;
  code: string;
  onChange: (code: string) => void;
  onRun: () => void;
  onReset: () => void;
  onClose: () => void;
}

/** The demo's source in the code editor, beside the running demo: Run (or ⌘/Ctrl+Enter), Reset,
 * Copy and Close in its header. */
export function CodePanel({ file, code, onChange, onRun, onReset, onClose }: CodePanelProps) {
  const { locale } = usePortal().route;
  // Captured before the editor, whose own Mod-Enter would insert a line.
  const keydown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    event.stopPropagation();
    onRun();
  };
  return (
    <section
      className="flex min-h-0 min-w-0 flex-col overflow-auto rounded-box border border-base-300 bg-base-200 p-3 pb-20"
      aria-label={file}
      data-code-panel
      onKeyDownCapture={keydown}
    >
      <CodeSurface
        code={code}
        locale={locale}
        title={file}
        actions={
          <>
            <Button size="sm" variant="primary" onClick={onRun} title="⌘/Ctrl+Enter">
              {t(locale, 'demo.run')}
            </Button>
            <Button size="sm" onClick={onReset}>
              {t(locale, 'demo.reset')}
            </Button>
            <Button size="sm" onClick={onClose}>
              {t(locale, 'actions.close')}
            </Button>
          </>
        }
      >
        <CodeInput value={code} onChange={onChange} label={t(locale, 'demo.editor')} />
      </CodeSurface>
    </section>
  );
}
