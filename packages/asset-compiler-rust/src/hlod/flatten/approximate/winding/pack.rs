//! The solid's field packed as the GPU's `winding` pass reads it (`gpu/winding.wgsl`, records in
//! `gpu/layout.rs`): the head; each wrapped mesh's field, its triangles in leaf order then its
//! nodes, about the mesh's own centre; the meshes' records; the instances' records, in the box
//! tree's leaf order; then the box tree over the instances' boxes.
use super::field::Field;
use super::{box_tree, Bounds, Instance, Link, Winding};
use crate::hlod::flatten::approximate::gpu::layout::{
    BINARY_DEPTH, BOUND_RECORDS, FIELD_NODE_RECORDS, HEAD_RECORDS, INSTANCE_RECORDS, LEAF,
    MESH_RECORDS, TRIANGLE_RECORDS,
};
use crate::hlod::flatten::approximate::gpu::pack::{pack_triangles, packed_boxes, Below};
use crate::hlod::flatten::approximate::gpu::{split_to_fit, Head};
use crate::hlod::flatten::gpu::failed;
use crate::hlod::flatten::gpu::pack::{base, depth, float, local};
use std::collections::{BTreeMap, BTreeSet};
use trillion3d_math::geometry::aabb::centre;
use trillion3d_math::vector::vecn::dot;

/// A link's two words: an inner node's children, a leaf's `LEAF` and first then its end.
fn link_words(link: &Link) -> [u32; 2] {
    match link {
        Link::Inner([left, right]) => [*left, *right],
        Link::Leaf(range) => [LEAF | range.start, range.end],
    }
}

/// `field`'s triangles then its nodes appended about `origin` — each node its expansion
/// (`layout::FIELD_NODE_RECORDS`), its box recomputed from its triangles as packed and widened,
/// its links —; their first records, nodes then triangles. Refused when the tree is deeper than
/// the walk's stack holds.
fn pack_field(words: &mut Vec<u32>, field: &Field, origin: [f64; 3]) -> crate::Result<[u32; 2]> {
    let deepest = link_depth(&field.links);
    if deepest > BINARY_DEPTH {
        return Err(failed(format!(
            "a winding field is {deepest} deep, past the walk's {BINARY_DEPTH}"
        )));
    }
    let triangles = base(words);
    let count = field.triangles.len();
    let packed = pack_triangles(words, count, |slot| field.triangles[slot], origin);
    let below = |at: usize| match &field.links[at] {
        Link::Inner(kids) => Below::Children(kids),
        Link::Leaf(range) => Below::Slots(range.start as usize..range.end as usize),
    };
    let (boxes, slack) = packed_boxes(field.links.len(), below, &packed);
    let nodes = base(words);
    words.reserve(field.links.len() * 24);
    for ((link, far), (low, high)) in field.links.iter().zip(&field.far).zip(boxes) {
        let (at, reach) = far.map_or(([0.0; 3], f32::MAX), |f| {
            (local(f.centre, origin), (f.reach as f32).min(f32::MAX))
        });
        let (first, s) = far.map_or(([0.0; 3], [[0.0; 3]; 3]), |f| (f.first, f.second));
        words.extend(at.map(f32::to_bits));
        words.push(reach.to_bits());
        words.extend(first.map(float));
        words.extend([s[0][0], s[0][1], s[0][2], s[1][0], s[1][1]].map(float));
        words.extend([s[1][2], s[2][0], s[2][1], s[2][2]].map(float));
        let [a, b] = link_words(link);
        words.extend(low.map(|x| (x - slack).to_bits()));
        words.push(a);
        words.extend(high.map(|x| (x + slack).to_bits()));
        words.push(b);
    }
    Ok([nodes, triangles])
}

/// `instance` appended (`layout::INSTANCE_RECORDS`), `mesh` its mesh's rank in the part: its box
/// about `origin` widened by `slack` and that rank, then its transform from the scene's points about `origin` into its mesh's
/// space about the mesh's centre `centre`.
fn pack_instance(
    words: &mut Vec<u32>,
    (instance, mesh): (&Instance, usize),
    (origin, centre): ([f64; 3], [f64; 3]),
    slack: f32,
) {
    pack_box(words, instance.bounds, origin, [mesh as u32, 0], slack);
    let inverse = &instance.inverse;
    for (r, row) in inverse.rows.iter().enumerate() {
        let shift = dot(*row, origin) + inverse.shift[r] - centre[r];
        words.extend(row.map(float));
        words.push(float(shift));
    }
}

/// A box about `origin` widened by `slack` on each side, its low and high corners' words, each
/// followed by its fourth word.
fn pack_box(
    words: &mut Vec<u32>,
    (low, high): Bounds,
    origin: [f64; 3],
    fourth: [u32; 2],
    slack: f32,
) {
    words.extend(local(low, origin).map(|x| (x - slack).to_bits()));
    words.push(fourth[0]);
    words.extend(local(high, origin).map(|x| (x + slack).to_bits()));
    words.push(fourth[1]);
}

/// The edges from a binary tree's root, its first node, to its deepest leaf.
fn link_depth(links: &[Link]) -> usize {
    depth(links.len(), |at| match &links[at] {
        Link::Inner(children) => &children[..],
        Link::Leaf(_) => &[],
    })
}

/// The box tree over some instances: its boxes and links in preorder, and the instances in its
/// leaf order — every instance in order, no tree, when the scene is not read as solids.
struct BoxTree {
    bounds: Vec<Bounds>,
    links: Vec<Link>,
    ranks: Vec<u32>,
}

impl BoxTree {
    /// The tree over the instances `picked` of `winding`, `boxes` the boxes of all of them.
    fn new(winding: &Winding, boxes: &[Bounds], picked: Vec<usize>) -> Self {
        let mut tree = Self {
            bounds: Vec::new(),
            links: Vec::new(),
            ranks: Vec::new(),
        };
        if winding.solids && !picked.is_empty() {
            box_tree(
                boxes,
                picked,
                (&mut tree.bounds, &mut tree.links, &mut tree.ranks),
            );
        } else {
            tree.ranks
                .extend(picked.into_iter().map(|rank| rank as u32));
        }
        tree
    }
}

/// The meshes the instances `picked` of `winding` place.
fn meshes_of(winding: &Winding, picked: &[usize]) -> BTreeSet<usize> {
    picked
        .iter()
        .map(|&i| winding.instances[i].wrapped)
        .collect()
}

/// The bytes the instances `picked` of `winding` take packed (`pack_part`): the head, the field
/// of each mesh they place, the meshes' records, the instances, and at most the nodes of the box
/// tree over them — every leaf of which holds at least two.
fn part_size(winding: &Winding, picked: &[usize]) -> u64 {
    let fields: usize = (meshes_of(winding, picked).iter())
        .map(|&m| {
            let field = &winding.fields[m].0;
            field.triangles.len() * TRIANGLE_RECORDS * 4
                + field.links.len() * FIELD_NODE_RECORDS * 4
                + MESH_RECORDS * 4
        })
        .sum();
    let nodes = if winding.solids {
        picked.len().max(1)
    } else {
        0
    };
    let words =
        HEAD_RECORDS * 4 + fields + picked.len() * INSTANCE_RECORDS * 4 + nodes * BOUND_RECORDS * 4;
    4 * words as u64
}

/// The field of the instances of `tree` of `winding`, the scene's points about `origin`, as the
/// winding pass reads it: the field of each mesh they place about its own centre, the meshes'
/// records, the instances in the tree's leaf order, the box tree, and the head (`gpu::Head`). An
/// instance's box is widened by eight units in the last place of the scene's largest coordinate,
/// so a point its instance holds is never left out by a rounding.
fn pack_part(winding: &Winding, tree: &BoxTree, origin: [f64; 3]) -> crate::Result<Vec<u32>> {
    let mut head: Head = [0; HEAD_RECORDS * 4];
    let mut words = vec![0u32; HEAD_RECORDS * 4];
    let instances: Vec<&Instance> = (tree.ranks.iter())
        .map(|&rank| &winding.instances[rank as usize])
        .collect();
    let meshes: BTreeSet<usize> = instances.iter().map(|i| i.wrapped).collect();
    let slots: BTreeMap<usize, usize> = meshes.iter().enumerate().map(|(s, &m)| (m, s)).collect();
    let fields: Vec<&(Field, Option<f64>)> = meshes.iter().map(|&m| &winding.fields[m]).collect();
    let centres: Vec<[f64; 3]> = (fields.iter())
        .map(|(field, _)| {
            field
                .boxes
                .first()
                .map_or([0.0; 3], |&(low, high)| centre(low, high))
        })
        .collect();
    let mut firsts = Vec::with_capacity(fields.len());
    for ((field, _), &centre) in fields.iter().zip(&centres) {
        firsts.push(pack_field(&mut words, field, centre)?);
    }
    head[4] = base(&words);
    for ((_, shell), [nodes, triangles]) in fields.iter().zip(firsts) {
        words.extend([nodes, triangles, float(shell.unwrap_or(0.0)), 0]);
    }
    let largest = (instances.iter())
        .flat_map(|instance| [instance.bounds.0, instance.bounds.1])
        .flat_map(|corner| (0..3).map(move |k| (corner[k] - origin[k]).abs()))
        .fold(0.0f64, f64::max);
    let slack = 8.0 * f32::EPSILON * largest as f32;
    head[2] = base(&words);
    head[3] = instances.len() as u32;
    for instance in &instances {
        let at = (origin, centres[slots[&instance.wrapped]]);
        pack_instance(&mut words, (instance, slots[&instance.wrapped]), at, slack);
    }
    let deepest = link_depth(&tree.links);
    if deepest > BINARY_DEPTH {
        return Err(failed(format!(
            "a shell's box tree is {deepest} deep, past the walk's {BINARY_DEPTH}"
        )));
    }
    head[0] = base(&words);
    head[1] = tree.links.len() as u32;
    for (bounds, link) in tree.bounds.iter().zip(&tree.links) {
        pack_box(&mut words, *bounds, origin, link_words(link), slack);
    }
    head[5] = u32::from(winding.solids);
    words[..head.len()].copy_from_slice(&head);
    Ok(words)
}

/// The field of `winding` for the winding pass, the scene's points about `origin`
/// (`pack_part`), in as many parts as no part takes more than `limit` bytes: the instances are
/// halved, in the box tree's leaf order, until each part fits. Refused when one instance's mesh
/// alone does not. The box tree over all the instances is built once, and is the first part's
/// when the scene fits.
pub(crate) fn pack(
    winding: &Winding,
    origin: [f64; 3],
    limit: u64,
) -> crate::Result<Vec<Vec<u32>>> {
    let boxes: Vec<Bounds> = winding.instances.iter().map(|i| i.bounds).collect();
    let count = boxes.len();
    let whole = BoxTree::new(winding, &boxes, (0..count).collect());
    let order: Vec<usize> = whole.ranks.iter().map(|&rank| rank as usize).collect();
    let mut whole = Some(whole);
    let mut parts = Vec::new();
    let size = |picked: &[usize]| part_size(winding, picked);
    split_to_fit(
        order,
        (&size, limit, "mesh"),
        &|mut picked| {
            let upper = picked.split_off(picked.len() / 2);
            (picked, upper)
        },
        &mut |picked| {
            let tree = (whole.take())
                .filter(|_| picked.len() == count)
                .unwrap_or_else(|| BoxTree::new(winding, &boxes, picked));
            parts.push(pack_part(winding, &tree, origin)?);
            Ok(())
        },
    )?;
    Ok(parts)
}
