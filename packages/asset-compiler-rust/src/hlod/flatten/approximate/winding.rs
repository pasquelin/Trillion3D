//! The field the approximation solidifies (`scene.rs` makes it): at a point, the sum over the
//! scene's instances whose box holds it of the value there of the mesh each places — the point
//! brought back into that mesh's own space through the instance's transform —: a mesh's
//! generalized winding number (Jacobson et al. 2013), read fast from its field (`field.rs`); a
//! thin part's, one where the point lies within its shell's radius of the part or where its
//! winding number passes `SHELL_WINDING`, else zero. The sum stops at the first instance whose
//! value reaches `SHELL_WINDING` in magnitude: the point is inside. Without thickening, the scene
//! holds no solid of its own: every instance is read wherever the point lies, and the sum never
//! stops early. The meshes' fields are built here, side by side; the field is read on the GPU
//! (`gpu/winding.wgsl`), packed for it in `pack`, in as many parts as one binding needs: the parts'
//! values are joined as the one walk's sum (`gpu::Pass::join`).
use trillion3d_math::geometry::aabb::merge_aabb;
mod affine;
mod field;
mod pack;
pub(crate) use affine::Affine;
use field::Field;
pub(crate) use pack::pack;

/// The winding number past which a thin part's point is inside without its shell, and the value
/// of an instance that stops the sum.
pub(crate) const SHELL_WINDING: f64 = 0.99;

/// A box: its least and greatest corners.
type Bounds = ([f64; 3], [f64; 3]);

/// A tree node's link: its two children's ranks, or its leaf's range — of the instances in
/// `Winding::ranks` for the box tree, of the triangles in leaf order for a field's tree.
enum Link {
    Inner([u32; 2]),
    Leaf(std::ops::Range<u32>),
}

/// A mesh the field wraps, in its own space, wound outwards: its triangles, each its corners, and
/// the radius of the shell a thin part is thickened by, none for a mesh read by its winding number.
pub(crate) type Wrapped = (Vec<[[f64; 3]; 3]>, Option<f64>);

/// One placement of a wrapped mesh: the mesh's rank, the transform bringing a point of the scene
/// into the mesh's own space, and the box in the scene its value is read within.
pub(crate) struct Instance {
    pub wrapped: usize,
    pub inverse: Affine,
    pub bounds: Bounds,
}

/// The scene's winding field: each wrapped mesh's field and shell radius, the instances, and
/// whether the scene is read as solids — each instance only within its box, the sum stopped
/// early. The tree over the instances' boxes is made as the field is packed (`pack`).
pub(crate) struct Winding {
    fields: Vec<(Field, Option<f64>)>,
    instances: Vec<Instance>,
    solids: bool,
}

/// The box tree over `ranks` of `boxes`, its nodes appended in preorder to `bounds` and `links`,
/// its leaves' instances to `leaves`; returns the root's rank.
fn box_tree(
    boxes: &[Bounds],
    mut ranks: Vec<usize>,
    (bounds, links, leaves): (&mut Vec<Bounds>, &mut Vec<Link>, &mut Vec<u32>),
) -> u32 {
    let mut own = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
    for &r in &ranks {
        merge_aabb(&mut own.0, &mut own.1, boxes[r].0, boxes[r].1);
    }
    let at = links.len();
    bounds.push(own);
    if ranks.len() <= 4 {
        let first = leaves.len() as u32;
        leaves.extend(ranks.iter().map(|&r| r as u32));
        links.push(Link::Leaf(first..leaves.len() as u32));
        return at as u32;
    }
    links.push(Link::Leaf(0..0));
    let axis = (0..3)
        .max_by(|&a, &b| (own.1[a] - own.0[a]).total_cmp(&(own.1[b] - own.0[b])))
        .unwrap_or(0);
    let centre = |r: usize| boxes[r].0[axis] + boxes[r].1[axis];
    ranks.sort_by(|&a, &b| centre(a).total_cmp(&centre(b)));
    let upper = ranks.split_off(ranks.len() / 2);
    let left = box_tree(boxes, ranks, (bounds, links, leaves));
    let right = box_tree(boxes, upper, (bounds, links, leaves));
    links[at] = Link::Inner([left, right]);
    at as u32
}

impl Winding {
    /// The field of the `wrapped` meshes placed by `instances`, each mesh's field built on its
    /// own, side by side; read as `solids` or not.
    pub fn new(wrapped: Vec<Wrapped>, mut instances: Vec<Instance>, solids: bool) -> Self {
        use rayon::prelude::*;
        let fields: Vec<(Field, Option<f64>)> = (wrapped.into_par_iter())
            .map(|(triangles, shell)| (Field::new(&triangles), shell))
            .collect();
        // A mesh none of whose triangles is finite has no field: its instances read nothing.
        instances.retain(|instance| !fields[instance.wrapped].0.links.is_empty());
        Self {
            fields,
            instances,
            solids,
        }
    }
}
