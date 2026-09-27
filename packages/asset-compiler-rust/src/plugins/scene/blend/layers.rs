//! Mesh attributes stored before the attribute store: the `CustomData` layers.
//!
//! Until Blender 5, a mesh keeps its arrays as layers of four `CustomData` blocks — one per
//! domain: vertex, edge, face, corner. Since 3.5 a layer is a **named attribute** typed by a
//! property code, its block the bare values: `position`, `.corner_vert`, `material_index`,
//! `sharp_face`, the UV maps. Before, from 2.8 to 3.4, the geometry lives in **structures** —
//! `MVert`, `MEdge`, `MPoly`, `MLoop` — and each UV map in a layer of `MLoopUV`; the reader
//! recognises them by the structure the SDNA gives their block, and repacks the fields it reads
//! into the attributes of the later layouts. Both feed the one mesh path: no second mesh builder.
use super::attrs::{
    Attr, BOOLEAN, CORNER, EDGE, FACE, FLOAT2, FLOAT3, INT32, MAX_ATTRIBUTES, POINT,
};
use super::*;
use std::borrow::Cow;

/// The `CustomData` block of each domain, and the mesh field that counts its elements.
const DOMAINS: [(&str, i64, &str); 4] = [
    ("vdata", POINT, "totvert"),
    ("edata", EDGE, "totedge"),
    ("pdata", FACE, "totpoly"),
    ("ldata", CORNER, "totloop"),
];
/// `MPoly.flag`: the face is smooth.
const SMOOTH: i64 = 1;
/// `MEdge.flag`: the edge is marked sharp.
const SHARP: i64 = 1 << 9;

/// The attribute type a property code names, for the types this driver reads.
fn property(code: i64) -> Option<i64> {
    match code {
        11 => Some(INT32),
        48 => Some(FLOAT3),
        49 => Some(FLOAT2),
        50 => Some(BOOLEAN),
        _ => None,
    }
}

/// Adds the attributes the `CustomData` layers of a mesh carry, in the order they declare them.
pub(super) fn attributes<'a>(mesh: &At<'a>, out: &mut Vec<(String, Attr<'a>)>) {
    for (field, domain, total) in DOMAINS {
        let count = mesh.int(total, 0).max(0) as usize;
        let Some(data) = mesh.inner(field) else {
            continue;
        };
        let Some((head, held)) = data.array("layers") else {
            continue;
        };
        let announced = data.int("totlayer", 0).max(0) as usize;
        for layer in (0..announced.min(held).min(MAX_ATTRIBUTES)).filter_map(|rank| head.item(rank))
        {
            let Some(block) = layer.reach(layer.pointer("data")) else {
                continue;
            };
            let name = layer.text("name");
            if let Some(kind) = property(layer.int("type", -1)) {
                let span = Attr::width(kind).and_then(|width| width.checked_mul(count));
                let Some(values) = mesh
                    .file
                    .bytes_of(block)
                    .filter(|bytes| span.is_some_and(|span| bytes.len() >= span))
                else {
                    continue;
                };
                out.push((name, attr(domain, kind, Cow::Borrowed(values), count)));
            } else if let Some(view) = mesh.file.view(block) {
                let count = count.min(block.len / view.layout.size.max(1));
                structures(&view, count, name, out);
            }
        }
    }
}

fn attr(domain: i64, kind: i64, values: Cow<'_, [u8]>, count: usize) -> Attr<'_> {
    Attr {
        domain,
        kind,
        values,
        count,
        single: false,
    }
}

/// The attributes a legacy structure array carries, repacked under the names of the later layouts.
fn structures<'a>(view: &At<'a>, count: usize, name: String, out: &mut Vec<(String, Attr<'a>)>) {
    type Read<'r, 'a> = &'r dyn Fn(&At<'a>, &mut Vec<u8>);
    let mut add = |name: &str, domain: i64, kind: i64, read: Read<'_, 'a>| {
        let mut values = Vec::with_capacity(count * Attr::width(kind).unwrap_or(0));
        for item in (0..count).filter_map(|rank| view.item(rank)) {
            read(&item, &mut values);
        }
        out.push((
            name.to_string(),
            attr(domain, kind, Cow::Owned(values), count),
        ));
    };
    let floats = |field: &'static str| {
        move |item: &At<'a>, values: &mut Vec<u8>| {
            values.extend(
                item.floats(field)
                    .iter()
                    .flat_map(|value| value.to_le_bytes()),
            );
        }
    };
    let int = |field: &'static str| {
        move |item: &At<'a>, values: &mut Vec<u8>| {
            values.extend((item.int(field, 0) as i32).to_le_bytes());
        }
    };
    let flag = |bit: i64, set: bool| {
        move |item: &At<'a>, values: &mut Vec<u8>| {
            values.push(u8::from((item.int("flag", 0) & bit != 0) == set));
        }
    };
    match view.layout.name.as_str() {
        "MVert" => add("position", POINT, FLOAT3, &floats("co")),
        "MEdge" => add("sharp_edge", EDGE, BOOLEAN, &flag(SHARP, true)),
        "MPoly" => {
            add("material_index", FACE, INT32, &int("mat_nr"));
            add("sharp_face", FACE, BOOLEAN, &flag(SMOOTH, false));
        }
        "MLoop" => {
            add(".corner_vert", CORNER, INT32, &int("v"));
            add(".corner_edge", CORNER, INT32, &int("e"));
        }
        "MLoopUV" => add(&name, CORNER, FLOAT2, &floats("uv")),
        _ => {}
    }
}

/// The face offsets of a mesh that stores its faces as `MPoly`: the first corner of each face,
/// then the end of the last. The caller checks that they rise and end at the corner count.
pub(super) fn offsets(mesh: &At<'_>, faces: usize, corners: usize) -> Option<Vec<u8>> {
    let block = mesh.reach(mesh.pointer("mpoly"))?;
    let polygons = mesh
        .file
        .view(block)
        .filter(|view| view.layout.name == "MPoly")?;
    if faces > block.len / polygons.layout.size.max(1) {
        return None;
    }
    let mut out = Vec::with_capacity((faces + 1) * 4);
    for face in (0..faces).filter_map(|rank| polygons.item(rank)) {
        out.extend_from_slice(&(face.int("loopstart", -1) as i32).to_le_bytes());
    }
    out.extend_from_slice(&(corners as i32).to_le_bytes());
    Some(out)
}
