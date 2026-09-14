//! Format numbers of the compiler. The cache it writes and the source manifest it reads are two
//! different formats and move on their own schedules; nothing may conflate them.

/// Cache format this compiler writes. Format 3 adds the per-cluster coplanar depth layer, which a
/// reader must understand before it draws a single cluster: formats 1 and 2 carry no such column
/// and are refused, never half-read.
pub const FORMAT_VERSION: u32 = 3;
/// Outer cache format required for clustered BLEND.
pub const CLUSTERED_BLEND_FORMAT_VERSION: u32 = 4;
/// Format of a prepared source manifest the compiler reads. An input format, not an output one.
pub const SOURCE_FORMAT_VERSION: u32 = 1;
