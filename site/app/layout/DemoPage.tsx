import { useRef, useState } from 'react';
import { t } from '../../content/i18n/index.ts';
import { Fab } from '../ui/Fab.tsx';
import { RenderFrame } from '../ui/RenderFrame.tsx';
import { Toast, useToast } from '../ui/Toast.tsx';
import { CodePanel } from './CodePanel.tsx';
import { usePortal } from './PortalContext.ts';
import { useDemo } from './useDemo.ts';

interface DemoPageProps {
  /** The standalone HTML file the demo runs, relative to the site root. */
  file: string;
  title: string;
}

/**
 * The page of a live demo: the demo fills the content area, and one floating button carries its
 * actions — the code (in a panel beside the demo, which keeps running: edit, run, reset, copy),
 * the link to share, the demo's own controls panel, fullscreen and restart.
 */
export function DemoPage({ file, title }: DemoPageProps) {
  const { locale } = usePortal().route;
  const demo = useDemo(file);
  const [coding, setCoding] = useState(false);
  const [toast, showToast] = useToast();
  const view = useRef<HTMLDivElement | null>(null);
  const share = () =>
    navigator.clipboard.writeText(location.href).then(
      () => showToast(t(locale, 'demo.linkCopied')),
      () => showToast(t(locale, 'demo.copyFailed')),
    );
  const { count, srcdoc } = demo.run;
  return (
    <section
      className={`grid h-full min-h-80 grid-cols-1 gap-3 ${coding ? 'grid-rows-2 lg:grid-cols-[minmax(0,11fr)_minmax(0,9fr)] lg:grid-rows-1' : 'grid-rows-1'}`}
      data-demo={file}
    >
      <title>{`${title} · Web Geometry`}</title>
      <h1 className="sr-only">{title}</h1>
      <RenderFrame fill ref={view} pending={demo.pending} loadingLabel={t(locale, 'demo.loading')}>
        <iframe
          key={count}
          ref={demo.frame}
          src={srcdoc === undefined ? file : undefined}
          srcDoc={srcdoc}
          title={title}
          onLoad={() => demo.loaded(count)}
        />
      </RenderFrame>
      {coding && (
        <CodePanel
          file={file}
          code={demo.code}
          onChange={demo.setCode}
          onRun={demo.runCode}
          onReset={demo.reset}
          onClose={() => setCoding(false)}
        />
      )}
      <Fab
        label={t(locale, 'demo.actions')}
        actions={[
          {
            id: 'code',
            icon: 'code',
            label: t(locale, 'demo.code'),
            pressed: coding,
            onClick: () => setCoding(!coding),
          },
          { id: 'share', icon: 'share', label: t(locale, 'demo.share'), onClick: share },
          {
            id: 'controls',
            icon: 'controls',
            label: t(locale, 'demo.controls'),
            pressed: demo.controls,
            onClick: demo.toggleControls,
          },
          {
            id: 'fullscreen',
            icon: 'fullscreen',
            label: t(locale, 'demo.fullscreen'),
            onClick: () => void view.current?.requestFullscreen().catch(() => {}),
          },
          {
            id: 'restart',
            icon: 'restart',
            label: t(locale, 'demo.restart'),
            onClick: demo.restart,
          },
        ]}
      />
      <Toast message={toast} />
    </section>
  );
}
