//! The raw ABI of the SDK's one WebAssembly module, `kernels.wasm`: each kernel's entry points and the hand-off of answers sized once built.
#[cfg(target_arch = "wasm32")]
pub(crate) mod clusters;
#[cfg(target_arch = "wasm32")]
pub(crate) mod culling;
#[cfg(target_arch = "wasm32")]
pub(crate) mod decode;
#[cfg(target_arch = "wasm32")]
pub(crate) mod encode;
#[cfg(target_arch = "wasm32")]
pub(crate) mod grid;
#[cfg(target_arch = "wasm32")]
pub(crate) mod held;
#[cfg(target_arch = "wasm32")]
pub(crate) mod math;
#[cfg(target_arch = "wasm32")]
#[cfg(target_arch = "wasm32")]
pub(crate) mod reach;
