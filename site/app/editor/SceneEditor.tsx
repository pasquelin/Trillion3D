import { useRef } from 'react';
import { useWords } from '../i18n.ts';
import { SITE_NAME } from '../layout/DocPage.tsx';
import { usePortal } from '../layout/PortalContext.ts';
import { RenderFrame } from '../ui/RenderFrame.tsx';
import { Toast, useToast } from '../ui/Toast.tsx';
import { EditorStats } from './EditorStats.tsx';
import { Inspector } from './Inspector.tsx';
import { MenuBar } from './MenuBar.tsx';
import { Outliner } from './Outliner.tsx';
import { Toolbar } from './Toolbar.tsx';
import { useEditor } from './useEditor.ts';

/**
 * The scene editor: a menu bar and the handles' tools above, the scene's tree on the left, the
 * view in the middle, the selection's properties on the right, the engine's statistics below.
 * Every edit goes through the engine's public API; the page draws nothing and moves nothing itself.
 */
export function SceneEditor() {
  const { locale } = usePortal().route;
  const t = useWords(locale);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [toast, showToast] = useToast();
  const editor = useEditor(canvas, locale, showToast);
  const title = t('editor.title');
  return (
    <section className="grid h-full min-h-0 grid-cols-1 grid-rows-[auto_minmax(0,1fr)_auto] gap-3">
      <title>{`${title} · ${SITE_NAME}`}</title>
      <h1 className="sr-only">{title}</h1>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {editor && <MenuBar editor={editor} />}
        {editor && <Toolbar editor={editor} />}
      </div>
      <div className="grid min-h-0 grid-cols-1 gap-3 lg:grid-cols-[14rem_minmax(0,1fr)_17rem]">
        {editor && <Outliner editor={editor} />}
        <div className="h-[60dvh] min-h-80 lg:h-full lg:min-h-0 lg:col-start-2 lg:row-start-1">
          <RenderFrame fill pending={!editor} loadingLabel={t('editor.loading')}>
            <canvas ref={canvas} aria-label={t('editor.canvas')} tabIndex={0} />
          </RenderFrame>
        </div>
        {editor && (
          <aside aria-label={t('editor.inspector')} className="min-h-0 overflow-y-auto">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-widest opacity-60">
              {t('editor.inspector')}
            </h2>
            <Inspector editor={editor} />
          </aside>
        )}
      </div>
      {editor && <EditorStats session={editor.session} />}
      <Toast message={toast} />
    </section>
  );
}
