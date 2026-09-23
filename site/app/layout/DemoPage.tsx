import { useRef, useState } from 'react';
import { t } from '../../content/i18n/index.ts';
import { CodeBlock } from '../ui/CodeBlock.tsx';
import { Fab } from '../ui/Fab.tsx';
import { Modal } from '../ui/Modal.tsx';
import { RenderFrame } from '../ui/RenderFrame.tsx';
import { Toast, useToast } from '../ui/Toast.tsx';
import { usePortal } from './PortalContext.ts';
import { useDemo } from './useDemo.ts';

interface DemoPageProps {
  /** The standalone HTML file the demo runs, relative to the site root. */
  file: string;
  title: string;
}

/**
 * The page of a live demo: the demo fills the content area, and one floating button carries its
 * actions — its source (in a modal, to read and copy), the link to share, the demo's own controls
 * panel, fullscreen and restart.
 */
export function DemoPage({ file, title }: DemoPageProps) {
  const { locale } = usePortal().route;
  const demo = useDemo(file);
  const [reading, setReading] = useState(false);
  const [toast, showToast] = useToast();
  const view = useRef<HTMLDivElement | null>(null);
  const share = () =>
    navigator.clipboard.writeText(location.href).then(
      () => showToast(t(locale, 'demo.linkCopied')),
      () => showToast(t(locale, 'demo.copyFailed')),
    );
  return (
    <section className="grid h-full min-h-80 grid-cols-1 grid-rows-1" data-demo={file}>
      <title>{`${title} · Web Geometry`}</title>
      <h1 className="sr-only">{title}</h1>
      <RenderFrame fill ref={view} pending={demo.pending} loadingLabel={t(locale, 'demo.loading')}>
        <iframe
          key={demo.run}
          ref={demo.frame}
          src={file}
          title={title}
          onLoad={() => demo.loaded(demo.run)}
        />
      </RenderFrame>
      <Fab
        label={t(locale, 'demo.actions')}
        actions={[
          {
            id: 'code',
            icon: 'code',
            label: t(locale, 'demo.code'),
            onClick: () => setReading(true),
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
      <Modal
        open={reading}
        onClose={() => setReading(false)}
        size="wide"
        title={file}
        closeLabel={t(locale, 'actions.close')}
      >
        <CodeBlock code={demo.source} locale={locale} language="html" label={file} />
      </Modal>
      <Toast message={toast} />
    </section>
  );
}
