//! Two neighbouring charts joined into one.
//!
//! The shared vertices: each boundary vertex of the first chart, in order, whose root vertex is
//! the root of exactly one boundary vertex of the second (two such refuse the join, as does a
//! vertex of the second shared twice). At least two must be shared, forming one chain along each
//! chart's rings. The joined chart takes the second chart's vertices and faces, then the first
//! chart's unshared vertices and its faces renumbered; it must be a manifold once rebuilt, and its
//! topology simplified (each extra boundary cut away) must keep one object with a boundary. It
//! borders the second chart's neighbours but the first, then the first chart's but the second,
//! each once.
use crate::hlod::flatten::uv::spectral::mesh::{Chart, Face, Vert, NONE};
use crate::hlod::flatten::uv::spectral::util::push_unique;
use std::collections::HashMap;

/// How the first chart's vertices map into the joined chart.
struct Shared {
    /// Per vertex of the first chart, its vertex in the joined chart.
    map: Vec<u32>,
    /// Per vertex of the first chart, whether it is copied (it is not shared).
    copied: Vec<bool>,
    /// The first chart's shared vertices, and their matches in the second, in order.
    first: Vec<u32>,
    second: Vec<u32>,
}

/// The vertices of `one` shared with `two`; `None` when the join is refused.
fn shared_vertices(one: &Chart, two: &Chart) -> Option<Shared> {
    let mut shared = Shared {
        map: vec![0; one.verts.len()],
        copied: vec![false; one.verts.len()],
        first: Vec::new(),
        second: Vec::new(),
    };
    let mut next = two.verts.len() as u32;
    // Per root vertex, the first boundary vertex of `two` there and how many are.
    let mut boundary_roots: HashMap<u32, (u32, u32)> = HashMap::new();
    for (j, w) in two.verts.iter().enumerate().filter(|(_, w)| w.boundary) {
        boundary_roots.entry(w.root).or_insert((j as u32, 0)).1 += 1;
    }
    let mut taken = vec![false; two.verts.len()];
    for (i, v) in one.verts.iter().enumerate() {
        shared.copied[i] = true;
        if !v.boundary {
            shared.map[i] = next;
            next += 1;
            continue;
        }
        let found = match boundary_roots.get(&v.root) {
            Some(&(j, 1)) => j,
            Some(_) => return None,
            None => NONE,
        };
        if found == NONE {
            shared.map[i] = next;
            next += 1;
            continue;
        }
        if taken[found as usize] {
            return None;
        }
        taken[found as usize] = true;
        shared.second.push(found);
        shared.first.push(i as u32);
        shared.map[i] = found;
        shared.copied[i] = false;
    }
    Some(shared)
}

/// Whether the vertices `chain` of `chart` form one connected chain along its rings.
fn connected(chart: &Chart, mut chain: Vec<u32>) -> bool {
    let mut checked = vec![chain.remove(0)];
    while !checked.is_empty() {
        let v = checked.remove(0);
        for &n in &chart.verts[v as usize].verts {
            if let Some(j) = chain.iter().position(|&s| s == n) {
                checked.push(chain.remove(j));
            }
        }
    }
    chain.is_empty()
}

/// The chart of `two`'s vertices and faces, then `one`'s copied vertices and its faces.
fn joined<'a>(one: &Chart<'a>, two: &Chart<'a>, shared: &Shared) -> Chart<'a> {
    let mut chart = Chart::new(two.source);
    chart.sub_chart = true;
    chart.diagonal = one.diagonal;
    let copy = |v: &Vert, id: usize| Vert {
        id: id as u32,
        root: v.root,
        importance: v.importance,
        ..Vert::default()
    };
    chart.verts = two
        .verts
        .iter()
        .enumerate()
        .map(|(i, v)| copy(v, i))
        .collect();
    for (i, v) in one.verts.iter().enumerate() {
        if shared.copied[i] {
            let id = chart.verts.len();
            chart.verts.push(copy(v, id));
        }
    }
    let face = |f: &Face, id: usize, verts: [u32; 3]| Face {
        id: id as u32,
        root: f.root,
        verts,
        ..Face::default()
    };
    chart.faces = two
        .faces
        .iter()
        .enumerate()
        .map(|(i, f)| face(f, i, f.verts))
        .collect();
    for f in &one.faces {
        let id = chart.faces.len();
        chart
            .faces
            .push(face(f, id, f.verts.map(|v| shared.map[v as usize])));
    }
    chart.area_3d = chart.area_3d_sum();
    chart.base_l2 = chart.base_l2_stretch();
    chart
}

/// Charts `one` and `two` (at those places of `charts`) joined; `None` when the join is refused.
pub(super) fn try_join<'a>(
    charts: &[Option<Chart<'a>>],
    one: usize,
    two: usize,
) -> crate::Result<Option<Chart<'a>>> {
    let (Some(first), Some(second)) = (&charts[one], &charts[two]) else {
        return Ok(None);
    };
    let Some(shared) = shared_vertices(first, second) else {
        return Ok(None);
    };
    if shared.first.len() <= 1
        || !connected(first, shared.first.clone())
        || !connected(second, shared.second.clone())
    {
        return Ok(None);
    }
    let mut chart = joined(first, second, &shared);
    if !chart.connect()? {
        return Ok(None);
    }
    loop {
        let (boundaries, simple) = chart.simplify_topology(true)?;
        if boundaries == 0 || chart.children.len() > 1 {
            return Ok(None);
        }
        if simple {
            break;
        }
        chart = chart.children.remove(0);
    }
    let mut neighbours: Vec<u32> = second
        .neighbours
        .iter()
        .copied()
        .filter(|&n| n as usize != one)
        .collect();
    for &n in &first.neighbours {
        if n as usize != two {
            push_unique(&mut neighbours, n);
        }
    }
    chart.neighbours = neighbours;
    chart.sub_chart = true;
    Ok(Some(chart))
}
