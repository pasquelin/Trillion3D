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
        for layer in layers(&data) {
            let name = layer.text("name");
            if let Some(kind) = property(layer.int("type", -1)) {
                let span = Attr::width(kind).and_then(|width| width.checked_mul(count));
                let Some(values) = layer
                    .block("data")
                    .filter(|bytes| span.is_some_and(|span| bytes.len() >= span))
                else {
                    continue;
                };
                out.push((name, attr(domain, kind, Cow::Borrowed(values), count)));
            } else if let Some((view, held)) = layer.array("data") {
                structures(&view, count.min(held), name, out);
            }
        }
    }
}

/// The layers of a `CustomData` block, as many as it announces and its layer array holds.
fn layers<'a>(data: &At<'a>) -> impl Iterator<Item = At<'a>> {
    let announced = data.int("totlayer", 0).max(0) as usize;
    let (head, held) = data.array("layers").unzip();
    let total = announced.min(held.unwrap_or(0)).min(MAX_ATTRIBUTES);
    (0..total).filter_map(move |rank| head.and_then(|head| head.item(rank)))
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

/// The bytes of one field in each of the first `count` structures of an array, the field looked
/// up once: a legacy array holds one structure per vertex, edge, face or corner. `count` is at most
/// what the array's block holds.
fn column<'a>(
    view: &At<'a>,
    count: usize,
    name: &str,
) -> Option<(&'a Field, impl Iterator<Item = &'a [u8]>)> {
    let field = view.layout.field(name)?;
    let (size, from) = (view.layout.size, view.base + field.offset);
    let width = field.unit.checked_mul(field.count)?;
    if size == 0 || field.offset.checked_add(width)? > size {
        return None;
    }
    let end = count.checked_mul(size)?.checked_add(view.base)?;
    let bytes = view.file.bytes.get(from..end.max(from))?;
    Some((
        field,
        bytes
            .chunks(size)
            .take(count)
            .map(move |cell| &cell[..width]),
    ))
}

/// The attributes a legacy structure array carries, repacked under the names of the later layouts.
fn structures<'a>(view: &At<'a>, count: usize, name: String, out: &mut Vec<(String, Attr<'a>)>) {
    type Pack<'p> = &'p dyn Fn(i64, &mut Vec<u8>);
    let mut add = |name: &str, domain: i64, kind: i64, field: &str, pack: Pack<'_>| {
        let Some((field, cells)) = column(view, count, field) else {
            return;
        };
        let mut values = Vec::with_capacity(count * Attr::width(kind).unwrap_or(0));
        for cell in cells {
            match field.kind.as_str() {
                "float" => values.extend_from_slice(cell),
                _ => pack(bytes::scalar(field, cell).unwrap_or(0), &mut values),
            }
        }
        out.push((
            name.to_string(),
            attr(domain, kind, Cow::Owned(values), count),
        ));
    };
    let int: Pack<'_> = &|value, values| values.extend((value as i32).to_le_bytes());
    let flag = |bit: i64, set: bool| {
        move |value: i64, values: &mut Vec<u8>| {
            values.push(u8::from((value & bit != 0) == set));
        }
    };
    match view.layout.name.as_str() {
        "MVert" => add("position", POINT, FLOAT3, "co", int),
        "MEdge" => add("sharp_edge", EDGE, BOOLEAN, "flag", &flag(SHARP, true)),
        "MPoly" => {
            add("material_index", FACE, INT32, "mat_nr", int);
            add("sharp_face", FACE, BOOLEAN, "flag", &flag(SMOOTH, false));
        }
        "MLoop" => {
            add(".corner_vert", CORNER, INT32, "v", int);
            add(".corner_edge", CORNER, INT32, "e", int);
        }
        "MLoopUV" => add(&name, CORNER, FLOAT2, "uv", int),
        _ => {}
    }
}

/// The face offsets of a mesh that stores its faces as `MPoly`: the first corner of each face,
/// then the end of the last. The caller checks that they rise and end at the corner count. The
/// structures are read from the face layer, not from `Mesh.mpoly`, which Blender 3.4 no longer
/// writes.
pub(super) fn offsets(mesh: &At<'_>, faces: usize, corners: usize) -> Option<Vec<i32>> {
    let (polygons, held) = layers(&mesh.inner("pdata")?)
        .filter_map(|layer| layer.array("data"))
        .find(|(view, _)| view.layout.name == "MPoly")?;
    if faces > held {
        return None;
    }
    let (field, starts) = column(&polygons, faces, "loopstart")?;
    let mut out: Vec<i32> = starts
        .map(|cell| bytes::scalar(field, cell).unwrap_or(-1) as i32)
        .collect();
    out.push(i32::try_from(corners).ok()?);
    Some(out)
}
