/** What the engine writes on the console starts with this, so a page's log tells it from its own. */
const PREFIX = '[trillion3d]'

const tell =
  (level: 'info' | 'warn' | 'error') =>
  (message: string, ...rest: unknown[]) =>
    console[level](`${PREFIX} ${message}`, ...rest)

/** The engine's one way to the console: the message after the engine's prefix, what follows as is. */
export const log = { info: tell('info'), warn: tell('warn'), error: tell('error') }
