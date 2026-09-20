import { useEffect, useRef, useState } from 'react';
import { runModule } from '../../js/code/execute.js';
import { CodeSurface } from './CodeSurface.jsx';
import { CodeInput } from './CodeInput.jsx';
import { Alert, Button } from './UI.jsx';

/** Initial source is a snapshot: an animation cannot replace an edited document. */
export function CodeEditor({ initialCode, resetCode, locale = 'en' }) {
  const [code, setCode] = useState(initialCode),
    [running, setRunning] = useState(false),
    [result, setResult] = useState(null),
    task = useRef(null);
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
