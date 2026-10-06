// The page's next animation frame, wherever a proof's page runs: in Chrome, or on Dawn, whose page
// browser (`onDawn.ts`) runs them sixty times a second as a browser does.

/**
 * The page's next animation frame, at its time: a proof draws each frame in one, as a page does.
 * Between two of them the event loop runs for a display interval — the device's answers arrive on
 * a task (Dawn's Node binding delivers them as a browser does), and the engine's asynchronous work
 * lands meanwhile — and the document timeline the engine reads its frame time from is the frame's.
 */
export const animationFrame = () => new Promise<number>((done) => requestAnimationFrame(done))
