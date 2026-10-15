//! The scene root of every driver whose format is not glTF's frame: the file's unit into metres,
//! then its up axis onto glTF's `Y`.

/// The centimetre, the implicit unit of the formats that declare a unit and default it (a USD
/// layer, a Maya scene): reading such a file as metres enlarges it a hundredfold.
pub(super) const CENTIMETRE: f64 = 0.01;

/// Scene-root matrix, column-major: a scale of `meters_per_unit`, and for a `Z`-up file the
/// −90° turn about `X` that sends `(x, y, z)` to `(x, z, −y)`, written exactly — its zeros are
/// zeros, not the rounding of a cosine.
pub(super) fn root(meters_per_unit: f64, z_up: bool) -> [f64; 16] {
    let s = meters_per_unit;
    match z_up {
        true => [
            s, 0.0, 0.0, 0.0, 0.0, 0.0, -s, 0.0, 0.0, s, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0,
        ],
        false => [
            s, 0.0, 0.0, 0.0, 0.0, s, 0.0, 0.0, 0.0, 0.0, s, 0.0, 0.0, 0.0, 0.0, 1.0,
        ],
    }
}
