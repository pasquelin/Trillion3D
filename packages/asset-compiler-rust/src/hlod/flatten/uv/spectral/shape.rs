//! What a chart's shape asks of the partition.
//!
//! - A plane (`plane`): every face of one normal is projected onto the plane of its first face of
//!   area; an almost-plane whose spectrum holds two dimensions is unfolded face by face from its
//!   first face of area, kept when no two edges cross and its stretch can be made finite.
//! - A trivial shape, a cylinder or a horn (`special`): a chart of no energy collapses to a point,
//!   a single face is laid flat; the ratios of the first four eigenvalues tell a cylinder, the
//!   first two (with one boundary) a horn, either kept only when the boundary stays at an even
//!   distance from the extreme vertex. A cylinder is cut across by the sign of its third (else
//!   second) embedding coordinate, a horn around its extreme vertex (`tube`).
//! - Any other shape (`general`): kept when its stretch can be made finite, else laid flat by
//!   barycentric coordinates when the stretch bound allows, else clustered around representative
//!   landmarks — those that reach farthest along each embedding dimension, the ones too close to
//!   the others dropped — and, when the clusters do not hold, cut face by face.
//! - A split in two by distance (`halve`): the faces clustered around two representatives, the
//!   border made a single cut path between two boundary points, the children laid out as their
//!   parent was.
mod general;
mod halve;
mod plane;
mod special;
mod tube;
