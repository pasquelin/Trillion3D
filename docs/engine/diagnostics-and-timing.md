# Diagnostics and timing

Diagnostics leave through a queued channel outside the measured call (`diagnostic/channel.ts`). The
device asks for every optional feature its kernels can use, each with a plain fallback
(`src/session/gpuDevice.ts`). GPU passes are timed by timestamp queries (`gpu/timing/`), the
stages mapped in `stage/mapping.ts`; CPU and GPU times are never added.
