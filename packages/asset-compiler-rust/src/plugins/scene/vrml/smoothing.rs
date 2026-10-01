//! Angle-derived hard edges feed the existing connectivity-aware normal generator.
use super::super::normals::{corners, Surface};
use super::*;
pub(super) fn generate(
    positions: &[f64],
    faces: &[Vec<usize>],
    crease: f64,
    request: &SceneRequest<'_>,
) -> Result<Vec<Vec<[f32; 3]>>> {
    let positions = positions
        .iter()
        .map(|v| source::finite(*v, "vrml"))
        .collect::<Result<Vec<_>>>()?;
    let mut indices = Vec::new();
    let mut offsets = vec![0u32];
    for face in faces {
        if face.len() < 3 || face.iter().any(|i| *i >= positions.len() / 3) {
            return Err(source::invalid("vrml", "invalid coordinate face"));
        }
        indices.extend(face.iter().map(|i| *i as u32));
        offsets.push(indices.len() as u32);
    }
    source::admit(
        indices.len().saturating_mul(96),
        request.ram_budget / 4,
        "vrml",
    )?;
    let sharp = vec![true; faces.len()];
    let mut surface = Surface {
        positions: &positions,
        corners: &indices,
        offsets: &offsets,
        sharp_faces: &sharp,
        sharp_corners: &[],
    };
    let cancelled = || crate::CompilerError::new(crate::CANCELLED, "Compilation cancelled");
    let flat = corners(&surface, request.cancelled).ok_or_else(cancelled)?;
    let mut hard = vec![false; indices.len()];
    let normals = if crease > 0. {
        let mut edges: BTreeMap<[u32; 2], Vec<(usize, usize)>> = BTreeMap::new();
        for (rank, face) in faces.iter().enumerate() {
            super::super::archive::check(request)?;
            for corner in 0..face.len() {
                let a = face[corner] as u32;
                let b = face[(corner + 1) % face.len()] as u32;
                edges
                    .entry([a.min(b), a.max(b)])
                    .or_default()
                    .push((rank, offsets[rank] as usize + corner));
            }
        }
        let limit = crease.min(std::f64::consts::PI).cos();
        for shared in edges.values() {
            if let [(a, ca), (b, cb)] = shared.as_slice() {
                let a = offsets[*a] as usize * 3;
                let b = offsets[*b] as usize * 3;
                let dot = (0..3)
                    .map(|i| flat.normals[a + i] as f64 * flat.normals[b + i] as f64)
                    .sum::<f64>();
                if dot < limit {
                    hard[*ca] = true;
                    hard[*cb] = true;
                }
            }
        }
        surface.sharp_faces = &[];
        surface.sharp_corners = &hard;
        corners(&surface, request.cancelled)
            .ok_or_else(cancelled)?
            .normals
    } else {
        flat.normals
    };
    Ok(offsets
        .windows(2)
        .map(|range| {
            normals[range[0] as usize * 3..range[1] as usize * 3]
                .as_chunks::<3>()
                .0
                .iter()
                .map(|n| [n[0], n[1], n[2]])
                .collect()
        })
        .collect())
}
