//! Exact geometry in the plane, for the approximated shell's ground cut and base cap: the sign of
//! a turn and of a point against a circle, decided exactly whatever the rounding of their inputs
//! (`predicates`); the constrained Delaunay triangulation of a polygon with holes (`delaunay`),
//! which fills the shell's cut where the ground plane meets it; the convex hull of a point set
//! (`hull`) and the triangulation of a simple polygon by its ears (`polygon`), which shape the
//! cap closing the scene's base.
pub(crate) mod delaunay;
pub(crate) mod hull;
pub(crate) mod polygon;
pub(crate) mod predicates;
