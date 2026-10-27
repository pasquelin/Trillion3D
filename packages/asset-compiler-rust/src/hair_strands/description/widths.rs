//! The width of the strands of a groom, in metres: the width a file gives, by the scope it names, and
//! the one a groom declares or lacks.

use crate::hair_strands::scope::Scope;

/// The width of a strand that neither it nor its groom gives, in metres: a tenth of a millimetre.
pub(crate) const DEFAULT_WIDTH: f32 = 0.0001;

/// The width of the strands, where the file gives one, in metres.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) enum Widths {
    /// The file gives none: the groom's width (`Description::groom_width`) is every strand's.
    #[default]
    None,
    /// One for each strand.
    Strand(Vec<f32>),
    /// One for each point.
    Vertex(Vec<f32>),
}

impl Widths {
    /// The widths `values` a file gives for `strands` curves of `points` points together, by the scope
    /// it names, each times `scale`, the metres its unit is worth — the node's matrix never scales a
    /// width. A constant one is the first value for each strand; none when `values` holds too few or
    /// the scope is none of the three a width is given for.
    pub(crate) fn from_scope(
        scope: Scope,
        values: &[f32],
        (strands, points): (usize, usize),
        scale: f32,
    ) -> Self {
        let metres = |each: &[f32]| each.iter().map(|width| width * scale).collect();
        match scope {
            Scope::Constant => values.first().map_or(Self::None, |width| {
                Self::Strand(vec![width * scale; strands])
            }),
            Scope::Uniform => values
                .get(..strands)
                .map_or(Self::None, |each| Self::Strand(metres(each))),
            Scope::Vertex => values
                .get(..points)
                .map_or(Self::None, |each| Self::Vertex(metres(each))),
            Scope::Other => Self::None,
        }
    }
}

/// A width a file declares for its whole groom, if it is a finite number.
pub(crate) fn finite_width(width: f64) -> Option<f32> {
    let width = width as f32;
    width.is_finite().then_some(width)
}
