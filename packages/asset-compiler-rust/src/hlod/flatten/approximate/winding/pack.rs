//! The solid's field packed as the GPU's `winding` pass reads it (`gpu/winding.wgsl`, records in
//! `gpu/layout.rs`): the head; each wrapped mesh's field, its triangles in leaf order then its
//! nodes, about the mesh's own centre; the meshes' records; the instances' records, in the box
//! tree's leaf order; then the box tree over the instances' boxes.
use super::field::Field;
use super::{Bounds, Instance, Link, Winding};
use crate::hlod::flatten::approximate::gpu::layout::{BINARY_DEPTH, HEAD_RECORDS, LEAF};
use crate::hlod::flatten::approximate::gpu::pack::{pack_triangles, packed_boxes, Below};
use crate::hlod::flatten::approximate::gpu::Head;
use crate::hlod::flatten::gpu::failed;
use crate::hlod::flatten::gpu::pack::{base, depth, float, local};
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

/// `instance` appended (`layout::INSTANCE_RECORDS`): its box about `origin` widened by `slack`
/// and its mesh's rank, then its transform from the scene's points about `origin` into its mesh's
/// space about the mesh's centre `centre`.
fn pack_instance(
    words: &mut Vec<u32>,
    instance: &Instance,
    (origin, centre): ([f64; 3], [f64; 3]),
    slack: f32,
) {
    pack_box(
        words,
        instance.bounds,
        origin,
        [instance.wrapped as u32, 0],
        slack,
    );
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

/// The field of `winding`, the scene's points about `origin`, as the winding pass reads it: each
/// wrapped mesh's field about its own centre, the meshes' records, the instances in the box tree's
/// leaf order — every instance in order when the scene is not read as solids —, the box tree, and
/// the head (`gpu::Head`). An instance's box is widened by eight units in the last place of the
/// scene's largest coordinate, so a point its instance holds is never left out by a rounding.
pub(crate) fn pack(winding: &Winding, origin: [f64; 3]) -> crate::Result<Vec<u32>> {
    let mut head: Head = [0; HEAD_RECORDS * 4];
    let mut words = vec![0u32; HEAD_RECORDS * 4];
    let centres: Vec<[f64; 3]> = (winding.fields.iter())
        .map(|(field, _)| {
            field
                .boxes
                .first()
                .map_or([0.0; 3], |&(low, high)| centre(low, high))
        })
        .collect();
    let mut firsts = Vec::with_capacity(winding.fields.len());
    for ((field, _), &centre) in winding.fields.iter().zip(&centres) {
        firsts.push(pack_field(&mut words, field, centre)?);
    }
    head[4] = base(&words);
    for ((_, shell), [nodes, triangles]) in winding.fields.iter().zip(firsts) {
        words.extend([nodes, triangles, float(shell.unwrap_or(0.0)), 0]);
    }
    let largest = (winding.instances.iter())
        .flat_map(|instance| [instance.bounds.0, instance.bounds.1])
        .flat_map(|corner| (0..3).map(move |k| (corner[k] - origin[k]).abs()))
        .fold(0.0f64, f64::max);
    let slack = 8.0 * f32::EPSILON * largest as f32;
    head[2] = base(&words);
    head[3] = winding.ranks.len() as u32;
    for &rank in &winding.ranks {
        let instance = &winding.instances[rank as usize];
        let at = (origin, centres[instance.wrapped]);
        pack_instance(&mut words, instance, at, slack);
    }
    let deepest = link_depth(&winding.links);
    if deepest > BINARY_DEPTH {
        return Err(failed(format!(
            "a shell's box tree is {deepest} deep, past the walk's {BINARY_DEPTH}"
        )));
    }
    head[0] = base(&words);
    head[1] = winding.links.len() as u32;
    for (bounds, link) in winding.bounds.iter().zip(&winding.links) {
        pack_box(&mut words, *bounds, origin, link_words(link), slack);
    }
    head[5] = u32::from(winding.solids);
    words[..head.len()].copy_from_slice(&head);
    Ok(words)
}
