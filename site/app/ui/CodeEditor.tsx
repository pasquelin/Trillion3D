import { useEffect, useRef, useState } from 'react';
import { useWords } from '../i18n.ts';
import type { Locale } from '../../content/locale.ts';
import { runModule } from '../code/execute.ts';
import type { ModuleExecutionResult, ModuleExecutionTask } from '../code/execute.ts';
import { CodeSurface } from './CodeSurface.tsx';
import { CodeInput } from './CodeInput.tsx';
import { Alert } from './Alert.tsx';
import { Button } from './Button.tsx';

/** Initial source is a snapshot: an animation cannot replace an edited document. */
interface CodeEditorProps {
  initialCode: string;
  resetCode: () => string;
  locale?: Locale;
}

export function CodeEditor({ initialCode, resetCode, locale = 'en' }: CodeEditorProps) {
  const [code, setCode] = useState(initialCode),
    [running, setRunning] = useState(false),
    [result, setResult] = useState<ModuleExecutionResult | null>(null),
    task = useRef<ModuleExecutionTask | null>(null);
  const t = useWords(locale);
  useEffect(() => {
    return () => {
      const previous = task.current;
      task.current = null;
      previous?.cancel();
    };
  }, []);
  async function run() {
    task.current?.cancel();
    setRunning(true);
    setResult(null);
    const current = runModule(code, new URL('js/engine.js', document.baseURI).href);
    task.current = current;
    const response = await current.promise;
    if (task.current !== current) return;
    task.current = null;
    setRunning(false);
    setResult(response);
  }
  function reset() {
    task.current?.cancel();
    task.current = null;
    setRunning(false);
    setResult(null);
    setCode(resetCode());
  }
  const message =
    result?.kind === 'timeout'
      ? t('code.timeout')
      : result?.kind === 'cancelled'
        ? t('code.cancelled')
        : result?.text;
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3" data-code-editor>
      <CodeSurface
        code={code}
        locale={locale}
        title={t('code.editable')}
        actions={
          <>
            <Button size="sm" variant="primary" onClick={run} disabled={running}>
              {t('code.run')}
            </Button>
            {running && (
              <Button size="sm" onClick={() => task.current?.cancel()}>
                {t('code.cancel')}
              </Button>
            )}
            <Button size="sm" onClick={reset}>
              {t('code.reset')}
            </Button>
          </>
        }
      >
        <CodeInput value={code} onChange={setCode} label={t('code.editor')} />
      </CodeSurface>
      {result && (
        <Alert tone={result.ok ? 'success' : 'error'} role="status">
          <div className="min-w-0 w-full">
            <strong>{t(result.ok ? 'code.result' : 'code.stopped')}</strong>
            <pre className="code-result">{message}</pre>
          </div>
        </Alert>
      )}
    </div>
  );
}
