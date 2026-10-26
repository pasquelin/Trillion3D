//! How the walk of a path goes on from a surface: the direction drawn, its density and the weight of
//! the colour carried.
use super::kernel::Stand;
use super::sampling::{cosine_hemisphere_world, tangent_to_world, uniform_hemisphere, Vec3};

/// How the walk goes on from a surface: the direction, the density it was drawn with and the
/// weight of the colour it carries.
pub(super) struct Bounce {
    pub direction: Vec3,
    pub pdf: f64,
    pub weight: Vec3,
}

pub(super) fn bounce_from(bounce: u32, on: &Stand, draw: &[f64; 4]) -> Bounce {
    if bounce == 0 {
        let (local, pdf) = uniform_hemisphere([draw[1], draw[0]]);
        return Bounce {
            direction: tangent_to_world(local, on.normal),
            pdf,
            weight: [1.0 / pdf; 3],
        };
    }
    let (direction, pdf) = cosine_hemisphere_world([draw[0], draw[1]], on.normal);
    Bounce {
        direction,
        pdf,
        weight: on.base,
    }
}
