# Principles

1. **Hosts use the public exports.** Engine, formats and contracts depend on no framework; a host
   (a page, an Electron app, a Node script) imports `trillion3d`, never `packages/` internals
   ([package architecture](../../packages/README.md)).
2. **Preparation is compiled and versioned.** Expensive assets are built outside the interactive
   loop, versioned with their schemas and loaded after manifest validation: no frame pays for it.
3. **The host application is never degraded.** The SDK negotiates capabilities, disables an
   optimisation whose measured overhead exceeds its benefit, and recovers from an error, a device
   loss, memory exhaustion or thrashing on the renderer already in use.
4. **Recovery is silent.** No technical warning at normal startup; full diagnostics in developer
   mode; a concise notice only when the machine grants no WebGPU device. Recovery keeps the scene
   state, with no flash, blank screen or visible restart.
