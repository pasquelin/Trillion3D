import { lazy, Suspense, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { exampleAddress, useWords } from '../i18n.ts';
import { Alert } from '../ui/Alert.tsx';
import { Button, LinkButton } from '../ui/Button.tsx';
import { CodeBlock } from '../ui/CodeBlock.tsx';
import { CodeSurface } from '../ui/CodeSurface.tsx';
import { Fab } from '../ui/Fab.tsx';
import { Modal } from '../ui/Modal.tsx';
import { RenderFrame } from '../ui/RenderFrame.tsx';
import { Toast, useToast } from '../ui/Toast.tsx';
import { SITE_NAME } from './DocPage.tsx';
import { usePortal } from './PortalContext.ts';
import { useDemo } from './useDemo.ts';
import { sandboxDocument, useSandbox } from './useSandbox.ts';

// The editor, and CodeMirror with it, loads with the sandbox alone.
const CodeInput = lazy(() => import('../ui/CodeInput.tsx').then((m) => ({ default: m.CodeInput })));

interface DemoPageProps {
  /** The standalone HTML file the demo runs, relative to the site root. */
  file: string;
  title: string;
  /** Makes the page the sandbox: the source is edited beside the render, under this picker of
   * the example it starts from. Without it, the source is read in a modal. */
  sandbox?: ReactNode;
  /** In the modal of the source, the link that opens it in the sandbox. */
  sandboxHref?: string;
}

/**
 * The page of a live demo: the demo fills the content area, and one floating button carries its
 * actions — its source (in a modal, to read and copy), the link to share, the demo's own controls
 * panel, fullscreen and restart. In the sandbox, the source is edited beside the demo instead —
 * left of it on wide screens, above it on narrow ones — and runs when asked.
 */
export function DemoPage({ file, title, sandbox, sandboxHref }: DemoPageProps) {
  const { locale } = usePortal().route;
  const t = useWords(locale);
  const demo = useDemo(file);
  const edits = useSandbox(file, demo.source);
  const [reading, setReading] = useState(false);
  const [toast, showToast] = useToast();
  const view = useRef<HTMLDivElement | null>(null);
  const share = () =>
    navigator.clipboard.writeText(location.href).then(
      () => showToast(t('demo.linkCopied')),
      () => showToast(t('demo.copyFailed')),
    );
  const editing = sandbox !== undefined;
  // Run and Reset render again even an unchanged source: the frame restarts.
  const rerun = (change: () => void) => () => {
    change();
    demo.restart();
  };
  return (
    <section
      className={
        editing
          ? 'grid grid-cols-1 grid-rows-[repeat(2,min(70dvh,40rem))] gap-4 lg:h-full lg:grid-cols-2 lg:grid-rows-1'
          : 'grid h-full min-h-80 grid-cols-1 grid-rows-1'
      }
      data-demo={file}
    >
      <title>{`${title} · ${SITE_NAME}`}</title>
      <h1 className="sr-only">{title}</h1>
      {editing && (
        <CodeSurface
          fill
          code={edits.code}
          locale={locale}
          title={sandbox}
          actions={
            <>
              <Button size="sm" variant="primary" onClick={rerun(edits.run)}>
                {t('code.run')}
              </Button>
              <Button size="sm" onClick={rerun(edits.reset)}>
                {t('code.reset')}
              </Button>
            </>
          }
        >
          <Suspense>
            <CodeInput value={edits.code} onChange={edits.edit} label={t('code.editor')} />
          </Suspense>
        </CodeSurface>
      )}
      <RenderFrame
        fill
        ref={view}
        pending={demo.pending}
        loadingLabel={t('demo.loading')}
        keyboard={demo.failed ? undefined : { mode: 'load', hint: t('demo.keyboardHint') }}
      >
        {/* A failed read says so, and offers to try again; the sandbox runs nothing before the
            source has arrived. */}
        {demo.failed ? (
          <Alert tone="error" role="alert" className="absolute inset-x-4 top-4 z-20">
            <span>{t('demo.loadFailed')}</span>
            <Button size="sm" onClick={demo.retry}>
              {t('demo.retry')}
            </Button>
          </Alert>
        ) : (
          (!editing || edits.shown) && (
            <iframe
              key={demo.run}
              ref={demo.frame}
              {...(editing
                ? {
                    srcDoc: sandboxDocument(
                      edits.shown,
                      new URL(exampleAddress(file, locale), document.baseURI).href,
                    ),
                  }
                : { src: exampleAddress(file, locale) })}
              title={title}
              allow="fullscreen"
              onLoad={() => demo.loaded(demo.run)}
            />
          )
        )}
      </RenderFrame>
      <Fab
        label={t('demo.actions')}
        actions={[
          {
            id: 'code',
            icon: 'code' as const,
            label: t('demo.code'),
            onClick: () => setReading(true),
          },
          { id: 'share', icon: 'share' as const, label: t('demo.share'), onClick: share },
          {
            id: 'controls',
            icon: 'controls' as const,
            label: t('demo.controls'),
            pressed: demo.controls,
            onClick: demo.toggleControls,
          },
          {
            id: 'fullscreen',
            icon: 'fullscreen' as const,
            label: t('demo.fullscreen'),
            onClick: () => void view.current?.requestFullscreen().catch(() => {}),
          },
          {
            id: 'restart',
            icon: 'restart' as const,
            label: t('demo.restart'),
            onClick: demo.restart,
          },
          // The sandbox has no Code action: its source is on the page already.
        ].filter(({ id }) => !(editing && id === 'code'))}
      />
      <Modal
        open={reading}
        onClose={() => setReading(false)}
        size="wide"
        title={file}
        closeLabel={t('actions.close')}
      >
        <CodeBlock
          code={demo.source}
          locale={locale}
          language="html"
          label={file}
          actions={
            sandboxHref && (
              <LinkButton size="sm" variant="primary" href={sandboxHref}>
                {t('sandbox.open')}
              </LinkButton>
            )
          }
        />
      </Modal>
      <Toast message={toast} />
    </section>
  );
}
