//! Small tools every stage shares: the job text from a file or standard input, little-endian fields, JSON merging, relative URIs and the durations per phase.
pub(crate) mod derived;
pub(crate) mod digest;
pub mod input;
pub mod json;
pub(crate) mod le;
pub(crate) mod neighbours;
pub(crate) mod perf;
pub(crate) mod uri;
