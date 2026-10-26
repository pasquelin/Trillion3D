//! Primitive modes other than a list of triangles, settled once at the load: a triangle strip or
//! fan becomes a list of triangles, with the winding a strip alternates and a fan keeps; a points
//! or lines primitive draws no surface and is left out, counted in the import report, the rest of
//! the document imported. Every reader after the load meets triangle lists alone.
use crate::compiler::accessor::codes::INDEX_COMPONENTS;
use crate::compiler::primitive::triangles::{primitive_mode, TRIANGLES};
use crate::compiler::source::assembly::plan::material_of;
use crate::compiler::source::load::compressed::Budget;
use crate::compiler::source::synth::{index_accessor, seal};
use crate::*;

const TRIANGLE_STRIP: usize = 5;

/// The reason a primitive left out is counted under in the import report.
pub(crate) const NOT_IMPORTED: &str = "primitive-mode-not-imported";

/// The triangle list of `indices` drawn as a strip (`fan` false) or a fan; whole triangles, none
/// when there are fewer than three indices.
fn list_of(indices: &[u32], fan: bool) -> Vec<u32> {
    let mut list = Vec::with_capacity(indices.len().saturating_sub(2) * 3);
    for (t, w) in indices.windows(3).enumerate() {
        match (fan, t % 2) {
            (true, _) => list.extend([indices[0], w[1], w[2]]),
            (false, 0) => list.extend([w[0], w[1], w[2]]),
            (false, _) => list.extend([w[1], w[0], w[2]]),
        }
    }
    list
}

/// The indices primitive `p` draws its vertices in: its index accessor, else the positions in order.
fn vertex_order(g: &Value, bin: &[u8], p: &Value) -> Result<Vec<u32>> {
    if let Some(id) = p.get("indices") {
        let ids = accessor(g, bin, required_index(Some(id), "primitive.indices")?, None)?;
        if ids.width != 1 || ids.normalized || !INDEX_COMPONENTS.contains(&ids.component) {
            return Err(invalid("indices component must be unsigned SCALAR"));
        }
        return ids.collect_u32();
    }
    let at = p
        .get("attributes")
        .and_then(|a| a.get("POSITION"))
        .ok_or_else(|| invalid("primitive.attributes.POSITION is required"))?;
    let at = required_index(Some(at), "primitive.attributes.POSITION")?;
    let count = accessor(g, bin, at, None)?.count;
    Ok((0..count as u32).collect())
}

/// Turns every strip and fan of the document into a list of triangles, its indices appended to the
/// binary within `budget`, and leaves out every points or lines primitive; returns the binary and
/// how many primitives were left out. A document of triangle lists alone is returned as it came,
/// a mapped binary still mapped. An assembly part's `materialRemap` is pinned to the primitives
/// that remain (`pin_remaps`).
pub(crate) fn triangulate_primitives(
    g: &mut Value,
    binary: Binary,
    budget: &Budget<'_>,
) -> Result<(Binary, usize)> {
    let mut jobs = Vec::new();
    let meshes = g.get("meshes").and_then(Value::as_array);
    for (mi, mesh) in meshes.into_iter().flatten().enumerate() {
        let primitives = mesh.get("primitives").and_then(Value::as_array);
        for (pi, p) in primitives.into_iter().flatten().enumerate() {
            if primitive_mode(p)? != TRIANGLES {
                jobs.push((mi, pi));
            }
        }
    }
    if jobs.is_empty() {
        return Ok((binary, 0));
    }
    let mut out = binary.into_owned(0)?;
    let mut left_out: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for (mi, pi) in jobs {
        let p = &g["meshes"][mi]["primitives"][pi];
        let mode = primitive_mode(p)?;
        let list = match mode {
            TRIANGLE_STRIP | 6 => list_of(&vertex_order(g, &out, p)?, mode == 6),
            _ => Vec::new(),
        };
        if list.is_empty() {
            left_out.entry(mi).or_default().push(pi);
            continue;
        }
        budget.admit(out.len().saturating_add(list.len() * 4 + 16))?;
        let id = index_accessor(g, &mut out, &list)?;
        let p = &mut g["meshes"][mi]["primitives"][pi];
        p["indices"] = json!(id);
        p["mode"] = json!(TRIANGLES);
    }
    seal(g, &out);
    // The remaps are settled while every primitive still stands: they are read by rank.
    pin_remaps(g, &left_out);
    let count = left_out.values().map(Vec::len).sum();
    for (mi, gone) in &left_out {
        if let Some(primitives) = g["meshes"][*mi]["primitives"].as_array_mut() {
            drop_ranks(primitives, gone);
        }
    }
    Ok((Binary::Owned(out), count))
}

/// Removes the entries of `list` at the ranks `gone`.
fn drop_ranks(list: &mut Vec<Value>, gone: &[usize]) {
    let mut rank = 0;
    list.retain(|_| {
        rank += 1;
        !gone.contains(&(rank - 1))
    });
}

/// The material of each primitive of mesh `mesh` of `g`, `null` for none.
fn slots_of(g: &Value, mesh: usize) -> Vec<Value> {
    let primitives = g["meshes"][mesh]["primitives"].as_array();
    let materials = primitives.into_iter().flatten().map(material_of);
    materials.map(|material| json!(material)).collect()
}

/// Gives every assembly part touched by a primitive left out, of its mesh or of its assembly mesh,
/// a `materialRemap` listing each primitive of its mesh as the assembly resolves it
/// (`parts::remapped`) while every primitive still stands, less the entries of the primitives left
/// out: the ranks a remap and the assembly's slots are read by must not shift when a primitive goes.
fn pin_remaps(g: &mut Value, left_out: &BTreeMap<usize, Vec<usize>>) {
    let mesh_count = g["meshes"].as_array().map_or(0, Vec::len);
    let slots: Vec<Vec<Value>> = (0..mesh_count).map(|mesh| slots_of(g, mesh)).collect();
    for assembly in 0..mesh_count {
        let Some(parts) = g["meshes"][assembly]
            .pointer_mut("/extras/assembly/parts")
            .and_then(Value::as_array_mut)
        else {
            continue;
        };
        for part in parts {
            let named = part.get("mesh").and_then(Value::as_u64).map(|m| m as usize);
            let Some(mesh) = named.filter(|&m| m < mesh_count) else {
                continue;
            };
            if !left_out.contains_key(&mesh) && !left_out.contains_key(&assembly) {
                continue;
            }
            let listed = match part.get("materialRemap").filter(|v| !v.is_null()) {
                None => None,
                Some(list) => match list.as_array() {
                    Some(list) => Some(list.clone()),
                    None => continue,
                },
            };
            let first = slots[assembly].first().cloned().unwrap_or(Value::Null);
            let mut worn: Vec<Value> = (0..slots[mesh].len())
                .map(|i| match &listed {
                    Some(list) => list.get(i).cloned().unwrap_or_else(|| first.clone()),
                    None => slots[assembly].get(i).cloned().unwrap_or(Value::Null),
                })
                .collect();
            if let Some(gone) = left_out.get(&mesh) {
                drop_ranks(&mut worn, gone);
            }
            part["materialRemap"] = Value::Array(worn);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::support::le::{f32_bytes, u32_bytes};

    fn budget(cancelled: &AtomicBool) -> Budget<'_> {
        Budget {
            limit: 1 << 20,
            cancelled,
        }
    }

    // A document of one mesh whose primitives all share five positions; `modes` names each
    // primitive's mode, `indices` its index list, left unindexed when none.
    fn document(modes: &[(usize, Option<&[u32]>)]) -> (Value, Binary) {
        let mut bytes = f32_bytes(&[0.0; 15]);
        let mut accessors =
            vec![json!({"bufferView":0,"componentType":5126,"count":5,"type":"VEC3"})];
        let mut views = vec![json!({"buffer":0,"byteOffset":0,"byteLength":60})];
        let mut primitives = Vec::new();
        for (mode, indices) in modes {
            let mut p = json!({"attributes":{"POSITION":0},"mode":mode});
            if let Some(indices) = indices {
                views.push(
                    json!({"buffer":0,"byteOffset":bytes.len(),"byteLength":indices.len() * 4}),
                );
                bytes.extend(u32_bytes(indices));
                accessors.push(json!({"bufferView":views.len() - 1,"componentType":5125,"count":indices.len(),"type":"SCALAR"}));
                p["indices"] = json!(accessors.len() - 1);
            }
            primitives.push(p);
        }
        let g = json!({
            "buffers":[{"byteLength":bytes.len()}], "bufferViews":views, "accessors":accessors,
            "meshes":[{"primitives":primitives}],
        });
        (g, Binary::Owned(bytes))
    }

    fn indices_of(g: &Value, bin: &Binary, primitive: usize) -> Vec<u32> {
        let p = &g["meshes"][0]["primitives"][primitive];
        assert_eq!(p["mode"], json!(4));
        let id = p["indices"].as_u64().expect("indices") as usize;
        accessor(g, bin.bytes(), id, None)
            .expect("accessor")
            .collect_u32()
            .expect("indices")
    }

    // Behaviour: a strip alternates its winding, a fan keeps its first vertex, indexed or not.
    #[test]
    fn strips_and_fans_become_triangle_lists() {
        let (mut g, bin) = document(&[
            (5, Some(&[0, 1, 2, 3, 4])),
            (6, Some(&[4, 0, 1, 2])),
            (5, None),
            (6, None),
        ]);
        let cancelled = AtomicBool::new(false);
        let (bin, left_out) =
            triangulate_primitives(&mut g, bin, &budget(&cancelled)).expect("pass");
        assert_eq!(left_out, 0);
        assert_eq!(indices_of(&g, &bin, 0), [0, 1, 2, 2, 1, 3, 2, 3, 4]);
        assert_eq!(indices_of(&g, &bin, 1), [4, 0, 1, 4, 1, 2]);
        assert_eq!(indices_of(&g, &bin, 2), [0, 1, 2, 2, 1, 3, 2, 3, 4]);
        assert_eq!(indices_of(&g, &bin, 3), [0, 1, 2, 0, 2, 3, 0, 3, 4]);
        assert_eq!(g["buffers"][0]["byteLength"], json!(bin.bytes().len()));
    }

    // Behaviour: points and lines are left out and counted, a strip of two vertices too, and a
    // part's remap loses the entries of the primitives gone; the triangle lists stay as they were.
    #[test]
    fn points_and_lines_are_left_out_and_counted() {
        let (mut g, bin) = document(&[
            (0, None),
            (4, Some(&[0, 1, 2])),
            (1, None),
            (5, Some(&[0, 1])),
            (4, Some(&[2, 3, 4])),
        ]);
        g["meshes"].as_array_mut().expect("meshes").push(json!({
            "primitives":[], "extras":{"assembly":{"parts":[{"mesh":0,"materialRemap":[0, 1, 2, 3, 4]}]}},
        }));
        let cancelled = AtomicBool::new(false);
        let (bin, left_out) =
            triangulate_primitives(&mut g, bin, &budget(&cancelled)).expect("pass");
        assert_eq!(left_out, 3);
        assert_eq!(
            g["meshes"][0]["primitives"]
                .as_array()
                .expect("primitives")
                .len(),
            2
        );
        assert_eq!(indices_of(&g, &bin, 1), [2, 3, 4]);
        assert_eq!(
            g["meshes"][1]["extras"]["assembly"]["parts"][0]["materialRemap"],
            json!([1, 4])
        );
    }

    // Behaviour: a document of triangle lists is returned untouched, its binary not copied.
    #[test]
    fn a_document_of_triangle_lists_is_untouched() {
        let (mut g, bin) = document(&[(4, Some(&[0, 1, 2]))]);
        let before = g.clone();
        let cancelled = AtomicBool::new(false);
        let (bin, left_out) =
            triangulate_primitives(&mut g, bin, &budget(&cancelled)).expect("pass");
        assert_eq!((left_out, g), (0, before));
        assert_eq!(bin.bytes().len(), 60 + 12);
    }
}
