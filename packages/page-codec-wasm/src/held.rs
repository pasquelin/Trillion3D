//! THE HAND-OFF of every answer whose size is known only once built — the page encoder's page
//! (`wasm_encode.rs`), the clusters (`wasm_clusters.rs`), the culling hierarchy (`wasm_culling.rs`)
//! and the proxy columns (`wasm_proxy.rs`): the builder leaves its bytes here (`hold`), the loader
//! copies them out of linear memory, `held_length` bytes from `held_at`, then lets them go
//! (`held_free`). One answer is held at a time: a build replaces the one before. The loader's side
//! is `takeHeld` (`packages/sdk-browser/src/wasm/wasmArena.ts`).

use std::cell::RefCell;

thread_local! {
    static HELD: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

/// Leaves `bytes` for the loader, in place of what was held.
pub fn hold(bytes: Vec<u8>) {
    HELD.with(|held| *held.borrow_mut() = bytes);
}

/// The byte offset of the held answer in linear memory.
#[no_mangle]
pub extern "C" fn held_at() -> u32 {
    HELD.with(|held| held.borrow().as_ptr() as u32)
}

/// The byte length of the held answer.
#[no_mangle]
pub extern "C" fn held_length() -> u32 {
    HELD.with(|held| held.borrow().len() as u32)
}

/// Lets the held answer go, once the loader copied it out.
#[no_mangle]
pub extern "C" fn held_free() {
    HELD.with(|held| drop(held.take()));
}
