/**
 * Le chronomètre carte graphique de WebGL2 : `EXT_disjoint_timer_query_webgl2`. Contrairement à
 * WebGPU, WebGL2 ne sait pas horodater une passe : il ne mesure qu'un intervalle de commandes. Ce
 * moteur soumet l'image entière en un seul `render`, donc l'intervalle mesuré est l'image entière —
 * et c'est ce qu'il annonce, sans jamais répartir cette durée sur des étapes qu'il n'a pas mesurées.
 *
 * La lecture ne bloque jamais : une requête est relue quelques images plus tard, et une requête
 * marquée « disjointe » par le pilote est jetée au lieu d'être publiée.
 */
type TimerExtension = {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
};

export function createWebglFrameTimer(gl: WebGL2RenderingContext | null | undefined) {
  const ext = gl?.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExtension | null;
  if (!gl || !ext)
    return {
      supported: false,
      reason: 'EXT_disjoint_timer_query_webgl2 absent de cet appareil',
      begin() {},
      end() {},
      poll: (): number | null => null,
    };
  let open: WebGLQuery | null = null;
  const pending: WebGLQuery[] = [];
  return {
    supported: true,
    reason: null as string | null,
    /** Ouvre l'intervalle ; une seule requête à la fois, la spécification n'en autorise pas deux. */
    begin() {
      if (open || pending.length > 4) return;
      const query = gl.createQuery();
      if (!query) return;
      open = query;
      gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
    },
    end() {
      if (!open) return;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      pending.push(open);
      open = null;
    },
    /** La durée en millisecondes d'une image déjà passée, ou `null` si aucune n'est prête. */
    poll(): number | null {
      if (!pending.length) return null;
      const query = pending[0];
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) return null;
      pending.shift();
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      const nanoseconds = gl.getQueryParameter(query, gl.QUERY_RESULT) as number;
      gl.deleteQuery(query);
      if (disjoint || !Number.isFinite(nanoseconds)) return null;
      return nanoseconds / 1e6;
    },
  };
}

export type WebglFrameTimer = ReturnType<typeof createWebglFrameTimer>;
