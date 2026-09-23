import { useEffect, useState } from 'react';
import type { RefObject } from 'react';

/** What the banner says: the example's line of what to do, then what it announces. */
interface Banner {
  title: string;
  line: string;
}

/** The banner the example in `frame` asks for (`site/examples/kit/banner.ts`), empty again at
 *  each run; the reader may close it. */
export function useBanner(frame: RefObject<HTMLIFrameElement | null>, run: number) {
  const [banner, setBanner] = useState<Banner | null>(null);
  useEffect(() => {
    setBanner(null);
    const hear = ({ source, data }: MessageEvent<Partial<Banner> & { type?: string }>) => {
      if (source !== frame.current?.contentWindow || data?.type !== 'trillion3d:banner') return;
      const [title, line] = [String(data.title ?? ''), String(data.line ?? '')];
      setBanner(title || line ? { title, line } : null);
    };
    addEventListener('message', hear);
    return () => removeEventListener('message', hear);
  }, [frame, run]);
  return [banner, () => setBanner(null)] as const;
}
