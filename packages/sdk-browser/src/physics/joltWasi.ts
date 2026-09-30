/** WASI preview1 fd_write for the standalone module's stdout/stderr diagnostics. */
export function diagnosticWrite(memory: WebAssembly.Memory) {
  return (fd: number, iovecs: number, count: number, written: number) => {
    if (fd !== 1 && fd !== 2) return 8; // EBADF: no filesystem or other descriptors.
    const view = new DataView(memory.buffer);
    const begin = iovecs >>> 0,
      end = begin + (count >>> 0) * 8,
      output = written >>> 0;
    if (end > view.byteLength || output + 4 > view.byteLength) return 21; // EFAULT.
    let total = 0;
    for (let at = begin; at < end; at += 8) {
      const start = view.getUint32(at, true),
        length = view.getUint32(at + 4, true);
      if (start + length > view.byteLength) return 21;
      total += length;
      if (total > 0xffffffff) return 61; // EOVERFLOW: nwritten is a wasm32 size.
    }
    const decoder = new TextDecoder();
    let text = '';
    for (let at = begin; at < end; at += 8)
      text += decoder.decode(
        new Uint8Array(memory.buffer, view.getUint32(at, true), view.getUint32(at + 4, true)),
        { stream: true },
      );
    text += decoder.decode();
    if (total) (fd === 1 ? console.log : console.error)(text.replace(/\n$/, ''));
    view.setUint32(output, total, true);
    return 0;
  };
}
