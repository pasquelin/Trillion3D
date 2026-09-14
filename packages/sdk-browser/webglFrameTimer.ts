/**
 * Le chronomètre carte graphique de WebGL2 : `EXT_disjoint_timer_query_webgl2`. Contrairement à
 * WebGPU, WebGL2 ne sait pas horodater une passe : il ne mesure qu'un intervalle de commandes. Ce
 * moteur soumet l'image entière en un seul `render`, donc l'intervalle mesuré est l'image entière —
 * et c'est ce qu'il annonce, sans jamais répartir cette durée sur des étapes qu'il n'a pas mesurées.
 *
 * La lecture ne bloque jamais : une requête est relue quelques images plus tard, et une requête
 * marquée « disjointe » par le pilote est jetée au lieu d'être publiée.
 */
/** Requêtes relues plus tard : au-delà, l'appareil ne suit pas et on cesse d'en ouvrir. */
const MAX_PENDING = 4;

type TimerExtension = {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
};

export function createWebglFrameTimer(gl: WebGL2RenderingContext | null | undefined) {
  const ext = gl?.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExtension | null;
  const reason = 'EXT_disjoint_timer_query_webgl2 absent de cet appareil';
  if (!gl || !ext)
    return {
      supported: false,
      reason,
      begin() {},
      end() {},
      poll: () => ({ ms: null as number | null, reason }),
    };
  let open: WebGLQuery | null = null;
  const pending: WebGLQuery[] = [];
  return {
    supported: true,
    reason: null as string | null,
    /** Ouvre l'intervalle ; une seule requête à la fois, la spécification n'en autorise pas deux. */
    begin() {
      if (open || pending.length > MAX_PENDING) return;
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
      // Sans présentation à l'écran, le flot de commandes peut rester chez le pilote et la requête
      // n'être jamais prête. `flush` le pousse sans jamais l'attendre — ce n'est pas un `finish`.
      gl.flush();
    },
    /** La durée d'une image déjà passée, ou la raison pour laquelle aucune n'est publiable. */
    poll(): { ms: number | null; reason: string | null } {
      if (!pending.length) return { ms: null, reason: 'aucune requête en attente' };
      const query = pending[0];
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE))
        return { ms: null, reason: 'résultat pas encore prêt' };
      pending.shift();
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      const nanoseconds = gl.getQueryParameter(query, gl.QUERY_RESULT) as number;
      gl.deleteQuery(query);
      if (disjoint)
        return { ms: null, reason: 'le pilote a interrompu la mesure (GPU_DISJOINT_EXT)' };
      if (!Number.isFinite(nanoseconds)) return { ms: null, reason: 'durée illisible' };
      return { ms: nanoseconds / 1e6, reason: null };
    },
  };
}
