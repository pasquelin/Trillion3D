import { useEffect, useState } from 'react';

/** A short message and the function that shows it; it clears itself after a few seconds. */
export function useToast(): [string, (message: string) => void] {
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(''), 2500);
    return () => clearTimeout(timer);
  }, [message]);
  return [message, setMessage];
}

/** The DaisyUI toast: one status line at the top of the screen, announced to screen readers. */
export function Toast({ message }: { message: string }) {
  return (
    <div className="toast toast-top toast-center z-[1000]" role="status" aria-live="polite">
      {message && <div className="alert alert-info">{message}</div>}
    </div>
  );
}
