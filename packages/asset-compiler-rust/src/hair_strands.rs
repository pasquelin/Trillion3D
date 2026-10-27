//! The hair strands of a scene: the curves an Alembic curves object or a USD `BasisCurves` carries,
//! merged into the one groom of the scene, grouped, packed as the renderer of strands reads them at
//! rest, and written in `hairStrands.bin`.
//!
//! - A scene driver reads the curves of an object into a `Description` — the positions, the point
//!   count of each curve, the widths in metres, and the root coordinates, colours, roughness and group
//!   numbers or names the file adds, each set by the scope the file names for it (`scope.rs`) — and
//!   cites it from the node that carries the object
//!   (`carrier.rs`): its arrays are accessors of the intermediate scene, its node's
//!   `TRILLION3D_hair_strands` extension names them.
//! - The compiler takes the descriptions out of the scene before anything reads it (`take`).
//! - The stage merges the descriptions of the nodes the scene shows into one, each placed by its
//!   node's world matrix (`stage.rs`), cuts it into groups by group number, in the order the file
//!   meets them, and builds each group with one level of detail, no interpolation, no guides and no
//!   clusters (`build.rs`, its packing `build/packing.rs`): the curves shuffled, their points and their radius, the length of each
//!   curve, the box and the longest curve and the greatest radius of the group, the points packed on
//!   eight bytes and the curves on four.
//! - `hairStrands.bin` (`encode.rs`) holds the groups of the scene's groom; the manifest's
//!   `hairStrands` section names it. A scene that carries no curve writes neither.
pub(crate) mod abi;
mod build;
pub(crate) mod carrier;
mod description;
mod encode;
mod scope;
mod stage;
#[cfg(test)]
mod tests;

pub(crate) use carrier::{carries, take, Carried};
pub(crate) use description::{finite_width, Description};
pub(crate) use scope::Scope;
pub(crate) use stage::{write_hair_strands, HairInputs};
