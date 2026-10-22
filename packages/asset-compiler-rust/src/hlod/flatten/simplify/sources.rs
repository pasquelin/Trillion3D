//! The cell's sources as the method reads them: every triangle of every original object, end to
//! end in the objects' order, in the frame the method's constants are written for — centimetres,
//! our `y` and `z` swapped, a mirror the triangles' index order follows (`units`) —, each with its
//! corners' normals and vertex colours, the coordinates its object's images are addressed by and
//! the image set it reads (`Sources`); their bounds, in single precision as the method keeps them; and the same
//! triangles in a field's index space (`InGrid`).
use super::volume::field::Polygons;
use crate::hlod::flatten::merge::mesh_normals;
use crate::hlod::flatten::units::{swap_axes, to_frame};
use trillion3d_page_codec::FLAG_NORMAL;

/// The axis `extents` is longest along, the last of equal ones.
pub(super) fn major_axis(extents: [f32; 3]) -> usize {
    let mut at = 0;
    for k in 1..3 {
        if extents[k] >= extents[at] {
            at = k;
        }
    }
    at
}

/// One original object of the cell as the sources take it: its triangles' world positions,
/// metres, its vertex normals, its vertex colours where it carries some, the image set each
/// triangle reads (`bake::Plan`) and the coordinates its corners address that set by, none for a
/// set of one value.
pub(super) struct Taken<'a> {
    pub positions: &'a [f32],
    pub normals: std::borrow::Cow<'a, [f32]>,
    pub colours: Option<&'a [f32]>,
    pub indices: &'a [u32],
    pub set: u32,
    pub laid: Option<&'a [[f64; 2]]>,
}

/// The vertex normals a piece carries, else its triangles' (`merge::mesh_normals`).
pub(super) fn normals_of<'a>(
    positions: &'a [f32],
    carried: &'a [trillion3d_page_codec::encode::Attribute],
    indices: &[u32],
) -> std::borrow::Cow<'a, [f32]> {
    match carried.iter().find(|a| a.flag == FLAG_NORMAL) {
        Some(normals) => std::borrow::Cow::Borrowed(&normals.values[..positions.len()]),
        None => std::borrow::Cow::Owned(mesh_normals(positions, indices)),
    }
}

/// The sources: their vertices' positions and normals in the method's frame, their colours
/// (white where a source carries none), their triangles and,
/// per triangle, its corners' image coordinates and its image set; and their bounds, low then
/// high corner — every corner of every triangle taken in, in single precision.
pub(crate) struct Sources {
    pub positions: Vec<[f32; 3]>,
    pub normals: Vec<[f32; 3]>,
    pub colours: Vec<[f32; 4]>,
    pub triangles: Vec<[u32; 3]>,
    pub laid: Vec<[[f64; 2]; 3]>,
    pub sets: Vec<u32>,
    pub low: [f32; 3],
    pub high: [f32; 3],
}

impl Sources {
    /// The sources of `taken`, in order.
    pub(super) fn of(taken: &[Taken]) -> Self {
        let mut sources = Self {
            positions: Vec::new(),
            normals: Vec::new(),
            colours: Vec::new(),
            triangles: Vec::new(),
            laid: Vec::new(),
            sets: Vec::new(),
            low: [f32::MAX; 3],
            high: [-f32::MAX; 3],
        };
        for piece in taken {
            let base = sources.positions.len() as u32;
            let points = piece.positions.as_chunks::<3>().0;
            let normals = piece.normals.as_chunks::<3>().0;
            sources
                .positions
                .extend(points.iter().map(|&p| to_frame(p)));
            sources
                .normals
                .extend(normals.iter().map(|&n| swap_axes(n)));
            match piece.colours {
                Some(colours) => sources
                    .colours
                    .extend_from_slice(colours.as_chunks::<4>().0),
                None => sources
                    .colours
                    .resize(sources.colours.len() + points.len(), [1.0; 4]),
            }
            for (t, &[a, b, c]) in piece.indices.as_chunks::<3>().0.iter().enumerate() {
                sources.triangles.push([a + base, b + base, c + base]);
                let laid = piece.laid.map_or([[0.0; 2]; 3], |laid| {
                    [laid[3 * t], laid[3 * t + 1], laid[3 * t + 2]]
                });
                sources.laid.push(laid);
                sources.sets.push(piece.set);
            }
        }
        for t in &sources.triangles {
            for &v in t {
                let p = sources.positions[v as usize];
                for (k, &component) in p.iter().enumerate() {
                    sources.low[k] = sources.low[k].min(component);
                    sources.high[k] = sources.high[k].max(component);
                }
            }
        }
        sources
    }

    /// Triangle `t`'s corners in the method's frame.
    pub(super) fn corners(&self, t: usize) -> [[f32; 3]; 3] {
        self.triangles[t].map(|v| self.positions[v as usize])
    }

    /// Triangle `t`'s corners' normals in the method's frame.
    pub(super) fn corner_normals(&self, t: usize) -> [[f32; 3]; 3] {
        self.triangles[t].map(|v| self.normals[v as usize])
    }

    /// Triangle `t`'s corners' vertex colours, white for a source that carries none.
    pub(super) fn corner_colours(&self, t: usize) -> [[f32; 4]; 3] {
        self.triangles[t].map(|v| self.colours[v as usize])
    }

    /// The length of the bounds' largest side, centimetres, the last of equal ones.
    pub(super) fn major_axis(&self) -> f32 {
        let extents: [f32; 3] = std::array::from_fn(|k| self.high[k] - self.low[k]);
        extents[major_axis(extents)]
    }

    /// Whether the bounds hold a volume: every side longer than nothing.
    pub(super) fn has_volume(&self) -> bool {
        (0..3).all(|k| self.high[k] > self.low[k])
    }
}

/// The sources' triangles in a field's index space: each corner times the voxel's inverse.
pub(super) struct InGrid<'a> {
    pub sources: &'a Sources,
    pub inverse: f64,
}

impl Polygons for InGrid<'_> {
    fn count(&self) -> usize {
        self.sources.triangles.len()
    }
    fn corners(&self, _: usize) -> usize {
        3
    }
    fn point(&self, polygon: usize, corner: usize) -> [f64; 3] {
        let v = self.sources.triangles[polygon][corner] as usize;
        self.sources.positions[v].map(|x| f64::from(x) * self.inverse)
    }
}
