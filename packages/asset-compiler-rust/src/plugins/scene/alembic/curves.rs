//! The curves of an Alembic `Curves` object as the file carries them — the strands of a groom —,
//! read into a `Description` (`hair_strands`): the positions and the point count of each curve, the
//! widths, and what the geometry parameters add.
//!
//! The curves and their points are read to the end of what the file declares: a curve that would
//! make the counts pass the points ends the object's curves, and the rest are left out; an object
//! with no point brings none. A width given once or for each curve is a strand's, one for each point
//! (scope `vertex`) is a point's; a width of another scope is not read. The root coordinates come from
//! the `uv` parameter, one for each curve, or for a parameter of scope `vertex` the value at the
//! curve's first point. The group number and name of each curve, and the colour and roughness of each
//! point, come from the `groom_group_id`, `groom_group_name`, `groom_color` and `groom_roughness`
//! parameters of the object's arbitrary geometry parameters, each in the types a groom writes it in.
//! The scope a parameter names says what its values are given for; what the groom makes of them, by
//! scope and by count, is `hair_strands`' (`Description::set_*`). The type of the curves, their basis
//! and their knots describe how a spline runs through the points: the strands are drawn through their
//! points, so none is read.
use super::archive::Archive;
use super::geom::{read_param, single_floats, Decode, Param};
use super::property::{Properties, POD_F32, POD_F64, POD_I16, POD_I32, POD_I8, POD_STRING};
use crate::hair_strands::{Description, Scope};
use crate::plugins::scene::spread::Spread;
use crate::support::le::words;
use crate::Result;

/// Single or double precision floats.
pub(super) fn floats(pod: u32, bytes: &[u8]) -> Option<Vec<f32>> {
    match pod {
        POD_F64 => Some(
            words(bytes, f64::from_le_bytes)
                .map(|value| value as f32)
                .collect(),
        ),
        _ => single_floats(pod, bytes),
    }
}

/// Floats, or integers taken for floats: a colour is written in either.
fn numbers(pod: u32, bytes: &[u8]) -> Option<Vec<f32>> {
    match pod {
        POD_I32 => Some(
            words(bytes, i32::from_le_bytes)
                .map(|value| value as f32)
                .collect(),
        ),
        _ => floats(pod, bytes),
    }
}

/// Integers of eight, sixteen or thirty-two bits.
fn integers(pod: u32, bytes: &[u8]) -> Option<Vec<i32>> {
    match pod {
        POD_I8 => Some(bytes.iter().map(|&byte| i32::from(byte as i8)).collect()),
        POD_I16 => Some(words(bytes, i16::from_le_bytes).map(i32::from).collect()),
        POD_I32 => Some(words(bytes, i32::from_le_bytes).collect()),
        _ => None,
    }
}

/// Text: each string ends on a zero byte.
fn strings(pod: u32, bytes: &[u8]) -> Option<Vec<String>> {
    (pod == POD_STRING).then(|| {
        let mut parts: Vec<&[u8]> = bytes.split(|&byte| byte == 0).collect();
        parts.pop();
        parts
            .into_iter()
            .map(|part| String::from_utf8_lossy(part).into_owned())
            .collect()
    })
}

/// The scope a parameter's metadata names.
pub(super) fn scope_of<T>(param: &Param<T>) -> Scope {
    match (param.scope, param.vertex) {
        (Spread::Constant, _) => Scope::Constant,
        (Spread::Uniform, _) => Scope::Uniform,
        (Spread::Point, true) => Scope::Vertex,
        _ => Scope::Other,
    }
}

/// A parameter's scope and its values behind the index table, `width` numbers each, for a groom of
/// `strands` curves. A scope set to the object's on as many values as there are curves is each
/// curve's.
pub(super) fn scoped<T: Clone>(
    param: Param<T>,
    width: usize,
    strands: usize,
) -> Option<(Scope, Vec<T>)> {
    let scope = scope_of(&param);
    let values = param.expanded(width)?;
    let scope = match scope {
        Scope::Constant if values.len() == strands * width => Scope::Uniform,
        other => other,
    };
    Some((scope, values))
}

/// The scope and values of the arbitrary parameter `name`, `width` numbers each, decoded by `decode`.
fn arbitrary<T: Clone>(
    archive: &Archive,
    params: &Properties,
    (name, width): (&str, u8),
    decode: Decode<T>,
    strands: usize,
) -> Result<Option<(Scope, Vec<T>)>> {
    let param = read_param(archive, params, name, width, decode)?;
    Ok(param.and_then(|param| scoped(param, usize::from(width), strands)))
}

/// The value of `values`, two numbers each, at the first point of each curve; none when a curve's
/// first point lies past them.
pub(super) fn first_points(values: &[f32], counts: &[u32]) -> Option<Vec<f32>> {
    let mut first = 0usize;
    let mut uvs = Vec::with_capacity(counts.len() * 2);
    for count in counts {
        uvs.extend_from_slice(values.get(first * 2..first * 2 + 2)?);
        first += *count as usize;
    }
    Some(uvs)
}

/// Sets the root coordinate of each curve from the `uv` parameter: the value of each curve when it is
/// given for the object or for each curve, the value at each curve's first point when it is given for
/// the points. No other scope is read.
fn set_root_uvs(description: &mut Description, param: Param<f32>) {
    let Some((scope, values)) = scoped(param, 2, description.counts.len()) else {
        return;
    };
    match scope {
        Scope::Constant | Scope::Uniform => description.set_root_uvs(scope, values),
        Scope::Vertex => {
            if let Some(uvs) = first_points(&values, &description.counts) {
                description.set_root_uvs(Scope::Uniform, uvs);
            }
        }
        Scope::Other => {}
    }
}

/// Sets the group name of each curve from the `groom_group_name` parameter: the name its index table
/// gives, or the string of each curve.
fn set_group_names(description: &mut Description, mut param: Param<String>) {
    match param.indices.take() {
        Some(indices) => description.set_indexed_group_names(&param.values, &indices),
        None => {
            if let Some((scope, names)) = scoped(param, 1, description.counts.len()) {
                description.set_group_names(scope, &names);
            }
        }
    }
}

/// Reads the curves of `geom`, the `.geom` of a `Curves` object. The groom is `None` when no point is
/// left to the object; the second member says whether the counts passed the points and the curves
/// after them were left out. `groom_width` is the width the groom declares for it, if it does.
pub(super) fn read(
    archive: &Archive,
    geom: &Properties,
    groom_width: Option<f32>,
) -> Result<(Option<Description>, bool)> {
    let (Some(positions), Some(declared)) = (
        geom.sample(archive, "P", POD_F32, Some(3))?,
        geom.sample(archive, "nVertices", POD_I32, Some(1))?,
    ) else {
        return Ok((None, false));
    };
    let positions = words(positions, f32::from_le_bytes).collect();
    let counts = words(declared, i32::from_le_bytes).map(i64::from);
    let (description, truncated) = Description::from_declared(positions, counts);
    let Some(mut description) = description else {
        return Ok((None, truncated));
    };
    let strands = description.counts.len();
    if let Some(param) = read_param(archive, geom, "width", 1, single_floats)? {
        let scope = scope_of(&param);
        if let Some(values) = param.expanded(1) {
            // Alembic has no unit: a width is read in the units of the positions it goes with.
            description.set_widths(scope, &values, 1.0);
        }
    }
    if let Some(param) = read_param(archive, geom, "uv", 2, single_floats)? {
        set_root_uvs(&mut description, param);
    }
    if let Some(params) = geom.compound(archive, ".arbGeomParams")? {
        let ids = arbitrary(archive, &params, ("groom_group_id", 1), integers, strands)?;
        if let Some((scope, values)) = ids {
            description.set_group_ids(scope, values);
        }
        let colors = arbitrary(archive, &params, ("groom_color", 3), numbers, strands)?;
        if let Some((scope, values)) = colors {
            description.set_colors(scope, values);
        }
        let roughness = arbitrary(archive, &params, ("groom_roughness", 1), floats, strands)?;
        if let Some((scope, values)) = roughness {
            description.set_roughness(scope, values);
        }
        if let Some(names) = read_param(archive, &params, "groom_group_name", 1, strings)? {
            set_group_names(&mut description, names);
        }
    }
    description.groom_width = groom_width;
    Ok((Some(description), truncated))
}
