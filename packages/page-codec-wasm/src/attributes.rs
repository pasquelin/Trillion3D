//! Désentrelacement d'une page décompressée : le miroir de `decodePageAttributes`.

use crate::{PageError, Vertex, STRIDE};

/// Bit de présence et largeur en flottants de chaque attribut facultatif, dans l'ordre du sommet :
/// normale, uv, tangente, uv2, couleur. La position occupe les trois premiers flottants.
pub const OPTIONAL: [(u32, usize); 5] = [(1, 3), (2, 2), (4, 4), (8, 2), (16, 4)];

/// Les tampons d'une page : les indices sur 32 bits, la position, puis les attributs facultatifs
/// présents à leur rang dans `OPTIONAL`. `decoded_bytes` est rempli par l'appelant.
pub struct DecodedPage {
    pub indices: Vec<u32>,
    pub position: Vec<f32>,
    pub optional: [Option<Vec<f32>>; 5],
    pub vertex_count: usize,
    pub flags: u32,
    pub decoded_bytes: usize,
}

/// Une page décodée se résume à ses comptes : imprimer ses tampons n'apprendrait rien.
impl core::fmt::Debug for DecodedPage {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(
            f,
            "DecodedPage {{ sommets: {}, indices: {}, drapeaux: {} }}",
            self.vertex_count,
            self.indices.len(),
            self.flags
        )
    }
}

/// Où lire chaque attribut dans un sommet : son rang (`None` pour la position), sa largeur et son
/// décalage en flottants. Le décalage ne dépend pas des drapeaux — un attribut absent laisse son
/// trou —, exactement comme le plan du décodeur JavaScript.
fn plan(flags: u32) -> Vec<(Option<usize>, usize, usize)> {
    let mut plan = Vec::with_capacity(6);
    plan.push((None, 3, 0));
    let mut place = 3;
    for (rang, &(bit, size)) in OPTIONAL.iter().enumerate() {
        if flags & bit != 0 {
            plan.push((Some(rang), size, place));
        }
        place += size;
    }
    plan
}

fn lis(vertex: &Vertex, at: usize) -> f32 {
    let octets = &vertex.0[at * 4..at * 4 + 4];
    f32::from_le_bytes([octets[0], octets[1], octets[2], octets[3]])
}

fn vides(vertex_count: usize, flags: u32) -> [Option<Vec<f32>>; 5] {
    let mut sortie: [Option<Vec<f32>>; 5] = [None, None, None, None, None];
    for (rang, &(bit, size)) in OPTIONAL.iter().enumerate() {
        if flags & bit != 0 {
            sortie[rang] = Some(vec![0f32; vertex_count * size]);
        }
    }
    sortie
}

/// Les indices d'abord, tous vérifiés avant qu'un seul flottant ne soit lu, puis les attributs.
pub fn split(
    local: &[u16],
    vertices: &[Vertex],
    vertex_count: usize,
    flags: u32,
) -> Result<DecodedPage, PageError> {
    let indices: Vec<u32> = local.iter().map(|&i| u32::from(i)).collect();
    for &index in &indices {
        if index as usize >= vertex_count {
            return Err(PageError::Index);
        }
    }
    let plan = plan(flags);
    let mut position = vec![0f32; vertex_count * 3];
    let mut optional = vides(vertex_count, flags);
    debug_assert_eq!(STRIDE / 4, 18);
    for (i, vertex) in vertices.iter().enumerate().take(vertex_count) {
        for &(rang, size, place) in &plan {
            let cible: &mut [f32] = match rang {
                None => &mut position,
                Some(rang) => optional[rang].as_mut().expect("attribut présent"),
            };
            for c in 0..size {
                let value = lis(vertex, place + c);
                if !value.is_finite() {
                    return Err(PageError::Nonfinite);
                }
                cible[i * size + c] = value;
            }
        }
    }
    Ok(DecodedPage {
        indices,
        position,
        optional,
        vertex_count,
        flags,
        decoded_bytes: 0,
    })
}
