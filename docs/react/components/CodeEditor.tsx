import { useEffect, useRef, useState } from 'react';
import type {
  CodeEditorProps,
  ModuleExecutionResult,
  ModuleExecutionTask,
} from '../types/components.ts';
import { runModule } from '../../js/code/execute.js';
import { CodeSurface } from './CodeSurface.tsx';
import { CodeInput } from './CodeInput.tsx';
import { Alert, Button } from './UI.tsx';

/** Initial source is a snapshot: an animation cannot replace an edited document. */
export function CodeEditor({ initialCode, resetCode, locale = 'en' }: CodeEditorProps) {
  const [code, setCode] = useState<string>(initialCode),
    [running, setRunning] = useState<boolean>(false),
    [result, setResult] = useState<ModuleExecutionResult | null>(null),
    task = useRef<ModuleExecutionTask | null>(null);
  const french = locale === 'fr';
  useEffect(
    () => () => {
      const previous = task.current;
      task.current = null;
      previous?.cancel();
    },
    [],
  );
  async function run() {
    task.current?.cancel();
    setRunning(true);
    setResult(null);
    const current: ModuleExecutionTask = runModule(
      code,
      new URL('js/engine.js', document.baseURI).href,
    );
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
      ? french
        ? 'Exécution interrompue après 3 secondes.'
        : 'Execution stopped after 3 seconds.'
      : result?.kind === 'cancelled'
        ? french
          ? 'Exécution annulée.'
          : 'Execution cancelled.'
        : result?.text;
  return (
    <div className="grid gap-3" data-code-editor>
      <CodeSurface
        code={code}
        locale={locale}
        title={french ? 'Code modifiable' : 'Editable code'}
        actions={
          <>
            <Button size="sm" variant="primary" onClick={run} disabled={running}>
              {french ? 'Exécuter' : 'Run'}
            </Button>
            {running && (
              <Button size="sm" onClick={() => task.current?.cancel()}>
                {french ? 'Annuler' : 'Cancel'}
              </Button>
            )}
            <Button size="sm" onClick={reset}>
              {french ? 'Reprendre les paramètres' : 'Reset from controls'}
            </Button>
          </>
        }
      >
        <CodeInput
          value={code}
          onChange={setCode}
          label={french ? 'Éditeur JavaScript' : 'JavaScript editor'}
        />
      </CodeSurface>
      {result && (
        <Alert tone={result.ok ? 'success' : 'error'} role="status">
          <div className="min-w-0 w-full">
            <strong>
              {result.ok
                ? french
                  ? 'Résultat du code'
                  : 'Code result'
                : french
                  ? 'Exécution arrêtée'
                  : 'Execution stopped'}
            </strong>
            <pre className="code-result">{message}</pre>
          </div>
        </Alert>
      )}
    </div>
  );
}
