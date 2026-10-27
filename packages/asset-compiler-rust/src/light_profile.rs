//! Light profiles: the shape of the light a lamp gives, from an IES photometric file.
//!
//! A scene names a profile on a point or a spot light (`attach.rs`); the compiler reads the file
//! (`ies.rs`), resamples its candela grid into a `SIDE` × `SIDE` texture divided by the greatest
//! candela (`grid.rs`) and writes it as a product of the cache (`format.rs`), one file for each
//! distinct profile, named by its bytes. The engine's profile atlas takes that file as it is.
//! The greatest candela travels with the texture as the profile's brightness: 1000 for a file
//! whose greatest is 0 or less.
mod attach;
mod format;
mod grid;
mod ies;
#[cfg(test)]
mod tests;

pub(crate) use attach::{linked_profiles, Profiles};

/// Texels along a side of a profile's texture.
pub(crate) const SIDE: usize = 256;
/// The brightness, in candelas, of a profile whose greatest candela is 0 or less.
pub(crate) const DEFAULT_BRIGHTNESS: f32 = 1000.0;

/// What an IES file holds: its angles, the candela at each (a row for each horizontal angle, a
/// column for each vertical one) and how the angles are laid out.
#[derive(Debug)]
pub(crate) struct Photometry {
    pub v_angles: Vec<f32>,
    pub h_angles: Vec<f32>,
    pub candela: Vec<f32>,
    /// Whether the file is of photometric type A, the one layout whose grid is read differently
    /// (`grid.rs`); type B and type C are read alike.
    pub type_a: bool,
    /// The greatest candela of the file, 0 at least.
    pub max_candela: f32,
}

impl Photometry {
    /// The profile's brightness: the greatest candela, or `DEFAULT_BRIGHTNESS` when there is none
    /// above 0.
    pub(crate) fn brightness(&self) -> f32 {
        if self.max_candela <= 0.0 {
            DEFAULT_BRIGHTNESS
        } else {
            self.max_candela
        }
    }
}
