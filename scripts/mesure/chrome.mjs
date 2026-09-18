// Le Chrome de la machine, lancé d'une seule façon pour le banc, l'oracle et les preuves de rendu.
//
// Playwright le trouve lui-même par son canal (`channel: 'chrome'`), sur Windows, macOS ou Linux :
// aucun chemin n'est écrit ici, et un poste sans Chrome installé reçoit l'erreur de Playwright,
// qui nomme ce qui manque. C'est le Chrome du poste qui est lancé, jamais le Chromium de
// Playwright : les mesures et les preuves portent sur le navigateur que l'utilisateur a.
import { chromium } from 'playwright';

/**
 * Lance le Chrome de la machine. `options` sont celles de `chromium.launch` — `headless`, `args` —,
 * le canal étant posé ici et nulle part ailleurs.
 */
export function lancerChrome(options = {}) {
  return chromium.launch({ channel: 'chrome', ...options });
}
