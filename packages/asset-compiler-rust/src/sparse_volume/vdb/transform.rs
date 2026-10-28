//! A grid's transform: the map from the index of a voxel to a position, read as the 4x4 matrix it
//! stands for (row vectors: the translation lies in the last row).
use super::cursor::Cursor;
use super::{invalid, unsupported};
use crate::Result;

/// The identity.
const IDENTITY: [f64; 16] = [
    1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
];

/// The matrix of a scale and a translation.
fn scale_translate(scale: [f64; 3], translation: [f64; 3]) -> [f64; 16] {
    let mut matrix = IDENTITY;
    for axis in 0..3 {
        matrix[axis * 5] = scale[axis];
        matrix[12 + axis] = translation[axis];
    }
    matrix
}

/// Reads the transform at the cursor: the name of its map, then the map's numbers. A scale map
/// holds five vectors (the scale, the voxel size, the inverse scale, the squared inverse, the
/// inverse of twice the scale), of which the first is the map; a translation precedes them where
/// the map translates.
pub(super) fn read(cursor: &mut Cursor) -> Result<[f64; 16]> {
    let name = cursor.string()?;
    match name.as_str() {
        "AffineMap" => cursor.f64s::<16>(),
        "TranslationMap" => Ok(scale_translate([1.0; 3], cursor.f64s::<3>()?)),
        "ScaleMap" | "UniformScaleMap" => {
            let numbers = cursor.f64s::<15>()?;
            Ok(scale_translate(
                [numbers[0], numbers[1], numbers[2]],
                [0.0; 3],
            ))
        }
        "ScaleTranslateMap" | "UniformScaleTranslateMap" => {
            let numbers = cursor.f64s::<18>()?;
            Ok(scale_translate(
                [numbers[3], numbers[4], numbers[5]],
                [numbers[0], numbers[1], numbers[2]],
            ))
        }
        "" => Err(invalid("a grid has a transform with no name")),
        other => Err(unsupported(format!(
            "the transform {other:?} of a grid is not read"
        ))),
    }
}
