//! The report codes several drivers write for one cause: one code per cause, the format being the
//! report's own (`source.plugin`), never a twin per importer.

/// A face whose ear cut had to be forced — a self-intersecting polygon, or one with no plane: it
/// came out fanned from its first corner, which can fill it beyond its silhouette.
pub(crate) const NGON_UNCUT: &str = "ngon-untriangulable";
/// A texture the source names and the served root does not hold, or no image driver reads.
pub(crate) const TEXTURE_MISSING: &str = "texture-missing";
/// A texture wired in a way glTF does not carry (a computation, a channel, a transform).
pub(crate) const TEXTURE_UNSUPPORTED: &str = "texture-unsupported";
/// An emission brighter than the material model carries, clamped.
pub(crate) const EMISSION_CLAMPED: &str = "emission-clamped";
/// An index of refraction the material model does not carry.
pub(crate) const IOR_UNSUPPORTED: &str = "ior-unsupported";
