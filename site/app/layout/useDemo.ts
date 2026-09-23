import { useEffect, useRef, useState } from 'react';
import { srcdocFor } from '../ui/srcdoc.ts';

/** What the demo page tells the example in its frame: show or hide its controls panel. */
interface ControlsMessage {
  type: 'wg:controls';
  visible: boolean;
}

/**
 * The state of one live demo: the example's source as fetched and as edited, what the frame runs
 * (the file, or the edited source), each run numbered so a new one remounts the frame, and
 * whether the example's controls panel is shown.
 */
export function useDemo(file: string) {
  const [original, setOriginal] = useState('');
  const [edited, setEdited] = useState<string | null>(null);
  const [run, setRun] = useState<{ count: number; srcdoc?: string }>({ count: 0 });
  const [loadedRun, setLoadedRun] = useState(-1);
  const [controls, setControls] = useState(true);
  const frame = useRef<HTMLIFrameElement | null>(null);
  useEffect(() => {
    const request = new AbortController();
    fetch(file, { signal: request.signal })
      .then((response) => (response.ok ? response.text() : Promise.reject(response.status)))
      .then(setOriginal)
      .catch(() => {});
    return () => request.abort();
  }, [file]);
  const code = edited ?? original;
  const post = (visible: boolean) => {
    const message: ControlsMessage = { type: 'wg:controls', visible };
    frame.current?.contentWindow?.postMessage(message, location.origin);
  };
  return {
    frame,
    code,
    run,
    pending: loadedRun !== run.count,
    controls,
    setCode: setEdited,
    /** The frame finished loading run `count`: it gets the panel's current state. */
    loaded: (count: number) => {
      setLoadedRun(count);
      post(controls);
    },
    runCode: () => setRun(({ count }) => ({ count: count + 1, srcdoc: srcdocFor(code, file) })),
    restart: () => setRun((current) => ({ ...current, count: current.count + 1 })),
    reset: () => {
      setEdited(null);
      setRun(({ count }) => ({ count: count + 1 }));
    },
    toggleControls: () => {
      setControls(!controls);
      post(!controls);
    },
  };
}
