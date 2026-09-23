import { useRef, useState } from 'react';
import { useWords } from '../i18n.ts';
import { SITE_NAME } from '../layout/DocPage.tsx';
import { usePortal } from '../layout/PortalContext.ts';
import { Panel } from '../ui/Panel.tsx';
import { RenderFrame } from '../ui/RenderFrame.tsx';
import { Toast, useToast } from '../ui/Toast.tsx';
import { Segmented, Toolbar, ToolbarDivider } from '../ui/Toolbar.tsx';
import { EditorStats } from './EditorStats.tsx';
import { Inspector } from './Inspector.tsx';
import { MenuBar } from './MenuBar.tsx';
import { Outliner } from './Outliner.tsx';
import { TransformTools } from './TransformTools.tsx';
import { useEditor } from './useEditor.ts';

type Side = 'outliner' | 'inspector';

/**
 * The scene editor, the whole width under the header: its bar of menus and tools, then the
 * scene's tree, the view with the examples' stats corner, and the selection's properties. On a
 * narrow screen the view comes first and one panel shows under it, picked by a switch. Every edit
 * goes through the engine's public API; the page draws nothing and moves nothing itself.
 */
export function SceneEditor() {
  const { locale } = usePortal().route;
  const t = useWords(locale);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [toast, showToast] = useToast();
  const [side, setSide] = useState<Side>('outliner');
  const editor = useEditor(canvas, locale, showToast);
  const title = t('editor.title');
  const shownBelow = (panel: Side) => (side === panel ? '' : 'max-lg:hidden');
  return (
    <section className="flex min-h-full flex-col lg:h-full">
      <title>{`${title} · ${SITE_NAME}`}</title>
      <h1 className="sr-only">{title}</h1>
      {editor && (
        <Toolbar label={title}>
          <MenuBar editor={editor} />
          <ToolbarDivider />
          <TransformTools editor={editor} />
        </Toolbar>
      )}
      <div className="grid flex-1 grid-cols-1 lg:min-h-0 lg:grid-cols-[16rem_minmax(0,1fr)_20rem]">
        <div className="h-[60dvh] min-h-72 p-2 lg:col-start-2 lg:row-start-1 lg:h-auto lg:min-h-0">
          <RenderFrame fill pending={!editor} loadingLabel={t('editor.loading')}>
            <canvas ref={canvas} aria-label={t('editor.canvas')} tabIndex={0} />
            {editor && <EditorStats session={editor.session} />}
          </RenderFrame>
        </div>
        {editor && (
          <>
            <div className="lg:hidden">
              <Toolbar label={t('editor.panels')}>
                <Segmented
                  value={side}
                  onChange={setSide}
                  options={[
                    { value: 'outliner', label: t('editor.outliner') },
                    { value: 'inspector', label: t('editor.inspector') },
                  ]}
                />
              </Toolbar>
            </div>
            <Panel
              title={t('editor.outliner')}
              className={`${shownBelow('outliner')} border-base-300 lg:col-start-1 lg:row-start-1 lg:border-e`}
            >
              <Outliner editor={editor} />
            </Panel>
            <Panel
              title={t('editor.inspector')}
              className={`${shownBelow('inspector')} border-base-300 lg:col-start-3 lg:row-start-1 lg:border-s`}
            >
              <Inspector editor={editor} />
            </Panel>
          </>
        )}
      </div>
      <Toast message={toast} />
    </section>
  );
}
