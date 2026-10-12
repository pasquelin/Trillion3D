//! The page decoder's refusals.

/// Refusal causes, in the order the decoder raises them. `code` is what crosses the WebAssembly
/// ABI: the `GEOMETRY_PAGE_*` message of the loader's error.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum PageError {
    Header = 1,
    Version = 2,
    Bounds = 3,
    Index = 4,
}

impl PageError {
    /// The refusal's code, as the loader throws it.
    pub fn code(self) -> &'static str {
        match self {
            PageError::Header => "GEOMETRY_PAGE_HEADER",
            PageError::Version => "GEOMETRY_PAGE_VERSION",
            PageError::Bounds => "GEOMETRY_PAGE_BOUNDS",
            PageError::Index => "GEOMETRY_PAGE_INDEX",
        }
    }
}
