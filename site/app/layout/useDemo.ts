import { useEffect, useRef, useState } from 'react';

/** What the demo page tells the example in its frame: show or hide its controls panel. */
interface ControlsMessage {
  type: 'wg:controls';
  visible: boolean;
}

/**
 * The state of one live demo: the example's source, read for the Code modal; each run of the
 * frame numbered, so a restart remounts it; whether the example's controls panel is shown.
 */
export function useDemo(file: string) {
  const [source, setSource] = useState('');
  const [run, setRun] = useState(0);
  const [loadedRun, setLoadedRun] = useState(-1);
  const [controls, setControls] = useState(true);
  const frame = useRef<HTMLIFrameElement | null>(null);
  useEffect(() => {
    const request = new AbortController();
    fetch(file, { signal: request.signal })
      .then((response) => (response.ok ? response.text() : Promise.reject(response.status)))
      .then(setSource)
      .catch(() => {});
    return () => request.abort();
  }, [file]);
  const post = (visible: boolean) => {
    const message: ControlsMessage = { type: 'wg:controls', visible };
    frame.current?.contentWindow?.postMessage(message, location.origin);
  };
  return {
    frame,
    source,
    run,
    pending: loadedRun !== run,
    controls,
    /** The frame finished loading run `count`: it gets the panel's current state. */
    loaded: (count: number) => {
      setLoadedRun(count);
      post(controls);
    },
    restart: () => setRun((count) => count + 1),
    toggleControls: () => {
      setControls(!controls);
      post(!controls);
    },
  };
}
