//! A chart's own mesh and its texture coordinates.
//!
//! A chart's mesh unifies the source's colocal vertices (each ring's least vertex, at the
//! position of the first corner that reaches it); its vertices are the source vertices it uses,
//! numbered in order of first use, each mapped to its unified vertex. Every chart is first
//! projected on its frame. A planar chart stops there; any other keeps the projection when no
//! boundary edge crosses, no face is turned or flat, it has surface, its stretch is at most `1.1`
//! and its largest stretch at most `1.25`; else it is given its conformal map, and is invalid when
//! that map has a coordinate that is not finite, crosses its boundary, turns a face or flattens
//! one. An invalid chart is cut into patches (`Patches`), each a chart of its own.
//!
//! A face group's charts: its segmentation's (planar, then clustered) in order, the valid ones
//! first, then the patches of the invalid ones.
use super::clustered::clustered_charts;
use super::conformal::conformal_map;
use super::grid::EdgeGrid;
use super::groups::group_mesh;
use super::mesh::TriMesh;
use super::piecewise::Patches;
use super::planar::{PlanarRegions, Surface};
use super::quality::{boundary_crosses, flips, stretch};
use super::vector::{Frame, Vec2};
use rayon::prelude::*;
use trillion3d_page_codec::encode::vertices::first_use;
use trillion3d_page_codec::hash::word_map;

pub(super) struct UvChart {
    /// The source faces, in the chart's order.
    pub(super) faces: Vec<usize>,
    /// Per chart vertex, its unified vertex.
    pub(super) unified: Vec<usize>,
    /// Per corner of `faces`, its chart vertex.
    pub(super) corners: Vec<u32>,
    /// The unified mesh; its texture coordinates are the chart's.
    pub(super) mesh: TriMesh,
}

/// The charts of the face group `faces` of `source`.
pub(super) fn build_charts(source: &TriMesh, faces: &[usize]) -> Vec<UvChart> {
    let surface = Surface::new(group_mesh(source, faces));
    let mut in_chart = vec![false; surface.mesh.face_count()];
    let planar = PlanarRegions::new(&surface, &mut in_chart);
    let clustered = clustered_charts(&surface, &planar, in_chart);
    let segments: Vec<(&[usize], Frame, bool)> = (planar.charts.iter())
        .map(|(local, frame)| (&local[..], *frame, true))
        .chain(
            clustered
                .iter()
                .map(|(local, frame)| (&local[..], *frame, false)),
        )
        .collect();
    let built: Vec<Result<UvChart, Vec<UvChart>>> = (segments.par_iter())
        .map(|&(local, frame, flat)| {
            let faces = local.iter().map(|&face| faces[face]).collect();
            parameterized(source, faces, frame, flat)
        })
        .collect();
    let mut charts = Vec::with_capacity(built.len());
    let mut patches = Vec::new();
    for chart in built {
        match chart {
            Ok(chart) => charts.push(chart),
            Err(pieces) => patches.extend(pieces),
        }
    }
    charts.extend(patches);
    charts
}

/// The chart of `faces`, parameterized: `Ok` when valid, else `Err` with its patches.
fn parameterized(
    source: &TriMesh,
    faces: Vec<usize>,
    frame: Frame,
    flat: bool,
) -> Result<UvChart, Vec<UvChart>> {
    let mut chart = UvChart::new(source, faces, |_, vertex| source.texcoords[vertex]);
    let mesh = &mut chart.mesh;
    for (uv, &p) in mesh.texcoords.iter_mut().zip(&mesh.positions) {
        *uv = frame.project(p);
    }
    if flat {
        return Ok(chart);
    }
    let mut grid = EdgeGrid::default();
    let crosses = boundary_crosses(mesh, &mut grid);
    let (turned, zero) = flips(mesh);
    let measured = stretch(mesh);
    let orthogonal = !crosses
        && turned == 0
        && zero == 0
        && measured.surface_area > 0.0
        && measured.mean <= 1.1
        && measured.max <= 1.25;
    if orthogonal {
        return Ok(chart);
    }
    conformal_map(mesh);
    // A map with a coordinate not finite (its solve broke down) would pass the tests below, which
    // see no crossing and no turn in NaN: it is cut into patches instead.
    let valid = mesh.texcoords.iter().flatten().all(|axis| axis.is_finite())
        && !boundary_crosses(mesh, &mut grid)
        && flips(mesh) == (0, 0);
    if valid {
        return Ok(chart);
    }
    let mut patches = Patches::new(&chart.mesh);
    let mut pieces = Vec::new();
    while patches.next_patch() {
        let (patch, texcoords) = (&patches.patch, &patches.texcoords);
        let faces = patch.iter().map(|&face| chart.faces[face]).collect();
        // A patch's vertex at the coordinates its patch laid the chart's vertex at.
        pieces.push(UvChart::new(source, faces, |corner, _| {
            texcoords[chart.mesh.indices[patch[corner / 3] * 3 + corner % 3]]
        }));
    }
    Err(pieces)
}

impl UvChart {
    /// The chart of the source faces `faces`, each unified vertex at the position and the texture
    /// coordinates `uv(corner, vertex)` of the first chart corner (`f · 3 + k`) that reaches it,
    /// `vertex` that corner's source vertex.
    fn new(source: &TriMesh, faces: Vec<usize>, uv: impl Fn(usize, usize) -> Vec2) -> UvChart {
        let corner_vertex = |corner: usize| source.indices[faces[corner / 3] * 3 + corner % 3];
        let (vertices, corners) = first_use((0..faces.len() * 3).map(corner_vertex));
        let mut mesh = TriMesh::default();
        let mut unified_of = word_map(vertices.len());
        let mut unified = Vec::with_capacity(vertices.len());
        for (corner, &chart_vertex) in corners.iter().enumerate() {
            // Chart vertices are numbered in order of first use: the one past those met is new.
            if chart_vertex as usize != unified.len() {
                continue;
            }
            let vertex = vertices[chart_vertex as usize];
            let next = mesh.positions.len();
            let at = *unified_of
                .entry(source.colocal_root(vertex))
                .or_insert(next);
            if at == next {
                mesh.add_vertex(source.positions[vertex], uv(corner, vertex));
            }
            unified.push(at);
        }
        for face in corners.as_chunks::<3>().0 {
            mesh.add_face(face.map(|chart_vertex| unified[chart_vertex as usize]));
        }
        mesh.match_opposites();
        UvChart {
            faces,
            unified,
            corners,
            mesh,
        }
    }
}
