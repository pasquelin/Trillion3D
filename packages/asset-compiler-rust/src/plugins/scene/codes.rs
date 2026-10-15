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
/// A mesh that yields no triangle.
pub(crate) const MESH_EMPTY: &str = "mesh-empty";
/// A mesh whose tables contradict themselves.
pub(crate) const MESH_INVALID: &str = "mesh-invalid";
/// A file whose structure does not hold: truncated, missing header, pointer outside it.
pub(crate) const FILE_INVALID: &str = "file-invalid";
/// Texture coordinates that do not cover every corner, dropped whole.
pub(crate) const UV_DROPPED: &str = "uv-dropped";
/// A transform that does not compose or is not finite.
pub(crate) const TRANSFORM_INVALID: &str = "transform-invalid";
/// A camera: the scene carries no viewpoint.
pub(crate) const CAMERA_UNSUPPORTED: &str = "camera-unsupported";
/// Normals that do not cover every corner, dropped whole.
pub(crate) const NORMALS_DROPPED: &str = "normals-dropped";
/// A hierarchy deeper than the read follows.
pub(crate) const HIERARCHY_TOO_DEEP: &str = "hierarchy-too-deep";
/// A block that declares more than the allocation ceiling admits.
pub(crate) const SIZE_UNSUPPORTED: &str = "size-unsupported";
/// Curves: no surface to draw.
pub(crate) const CURVES_UNSUPPORTED: &str = "curves-unsupported";
/// A light with no punctual equivalent.
pub(crate) const LIGHT_UNSUPPORTED: &str = "light-unsupported";
/// A texture read from a channel glTF does not carry there.
pub(crate) const TEXTURE_CHANNEL_UNSUPPORTED: &str = "texture-channel-unsupported";
/// A face of fewer than three corners.
pub(crate) const DEGENERATE_FACE: &str = "degenerate-face";
/// A wrap mode glTF does not carry: the axis repeats.
pub(crate) const TEXTURE_WRAP_UNSUPPORTED: &str = "texture-wrap-unsupported";
