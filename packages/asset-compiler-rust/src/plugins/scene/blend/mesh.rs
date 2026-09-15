//! Un maillage Blender vers une géométrie triangulée.
//!
//! Le maillage est décrit par coins : un tableau d'offsets dit où chaque face commence dans la
//! suite des coins, et chaque coin renvoie à un sommet. Les UV vivent au coin, l'indice de matériau
//! et le marquage « face nette » vivent à la face. Les n-gones sont coupés en oreilles dans le plan
//! de leur normale, ce qui conserve exactement les sommets, l'aire et l'orientation d'une face
//! plane, qu'elle soit convexe ou creusée.
//!
//! Aucune normale n'est stockée dans un fichier Blender : elles sont calculées à la lecture, à plat
//! pour une face nette, moyennées par aire pour une face lisse.
use super::*;

/// Plafonds de lecture d'un maillage, pour qu'un fichier abîmé ne demande jamais une allocation
/// qu'il n'a pas les octets de remplir.
const MAX_VERTICES: usize = 64 * 1024 * 1024;
const MAX_CORNERS: usize = 256 * 1024 * 1024;

/// La géométrie d'un maillage, telle que le fichier la porte.
pub(super) struct Geometry {
    pub(super) positions: Vec<f32>,
    /// Le sommet de chaque coin.
    pub(super) corners: Vec<u32>,
    /// Le premier coin de chaque face, plus la fin du dernier : `faces + 1` valeurs.
    pub(super) offsets: Vec<u32>,
    /// Deux flottants par coin, vide quand le maillage ne porte aucune couche d'UV.
    pub(super) uv: Vec<f32>,
    pub(super) material: Vec<u32>,
    pub(super) sharp: Vec<bool>,
}

impl Geometry {
    pub(super) fn faces(&self) -> usize {
        self.offsets.len().saturating_sub(1)
    }
    /// Les coins d'une face, dans l'ordre du fichier.
    pub(super) fn face(&self, rank: usize) -> &[u32] {
        let from = self.offsets[rank] as usize;
        let to = self.offsets[rank + 1] as usize;
        &self.corners[from..to]
    }
}

fn unsupported(mesh: &str, what: &str) -> CompilerError {
    refused(
        "blend-mesh-layout-unsupported",
        format!("blend: mesh {mesh} carries no {what}; this reader reads the named-attribute layout of Blender 4.4 and later"),
    )
}

/// Lit la géométrie d'un maillage. Un maillage qui ne porte pas la disposition par attributs est
/// refusé par son nom plutôt que deviné.
pub(super) fn read(mesh: &At<'_>, name: &str) -> Result<Geometry> {
    let vertices = mesh.int("totvert", 0).max(0) as usize;
    let corner_count = mesh.int("totloop", 0).max(0) as usize;
    let faces = mesh.int("totpoly", 0).max(0) as usize;
    if vertices > MAX_VERTICES || corner_count > MAX_CORNERS {
        return Err(refused(
            "blend-too-large",
            format!("blend: mesh {name} announces more vertices or corners than this reader reads"),
        ));
    }
    let table = attrs::attributes(mesh);
    let positions = named(&table, "position", attrs::POINT, attrs::FLOAT3)
        .map(|attr| attr.floats(vertices, 3))
        .filter(|values| values.len() == vertices * 3)
        .ok_or_else(|| unsupported(name, "position attribute"))?;
    let corners = named(&table, ".corner_vert", attrs::CORNER, attrs::INT32)
        .map(|attr| attr.ints(corner_count))
        .filter(|values| values.len() == corner_count)
        .ok_or_else(|| unsupported(name, ".corner_vert attribute"))?;
    let offsets = offsets(mesh, faces, corner_count)
        .ok_or_else(|| unsupported(name, "readable face offsets"))?;
    if corners
        .iter()
        .any(|vertex| *vertex < 0 || *vertex as usize >= vertices)
    {
        return Err(refused(
            "blend-mesh-invalid",
            format!("blend: mesh {name} has a corner pointing outside its vertices"),
        ));
    }
    let material = named(&table, "material_index", attrs::FACE, attrs::INT32)
        .map(|attr| attr.ints(faces))
        .filter(|values| values.len() == faces)
        .map(|values| values.iter().map(|slot| (*slot).max(0) as u32).collect())
        .unwrap_or_else(|| vec![0; faces]);
    let sharp = named(&table, "sharp_face", attrs::FACE, attrs::BOOLEAN)
        .map(|attr| attr.bools(faces))
        .filter(|values| values.len() == faces)
        .unwrap_or_else(|| vec![false; faces]);
    Ok(Geometry {
        positions,
        corners: corners.iter().map(|vertex| *vertex as u32).collect(),
        offsets,
        uv: uv(&table, corner_count),
        material,
        sharp,
    })
}

/// L'attribut du nom, du domaine et du type demandés, quand le maillage le porte.
fn named<'t, 'b>(
    table: &'t [(String, attrs::Attr<'b>)],
    wanted: &str,
    domain: i64,
    kind: i64,
) -> Option<&'t attrs::Attr<'b>> {
    table
        .iter()
        .find(|(name, attr)| name == wanted && attr.domain == domain && attr.kind == kind)
        .map(|(_, attr)| attr)
}

/// Les offsets de faces : un tableau de `faces + 1` entiers croissants, borné par les coins.
fn offsets(mesh: &At<'_>, faces: usize, corners: usize) -> Option<Vec<u32>> {
    let bytes = ["poly_offset_indices", "face_offset_indices"]
        .into_iter()
        .find_map(|name| mesh.block(name))?;
    let values = bytes::ints(bytes, faces + 1);
    if values.len() != faces + 1 {
        return None;
    }
    let mut out = Vec::with_capacity(values.len());
    let mut previous = 0u32;
    for value in values {
        let value = u32::try_from(value).ok()?;
        if value < previous || value as usize > corners {
            return None;
        }
        previous = value;
        out.push(value);
    }
    (out.last() == Some(&(corners as u32))).then_some(out)
}

/// La couche d'UV retenue : la première couche flottante à deux composantes portée par les coins et
/// nommée par l'auteur. Les couches internes de Blender commencent par un point, et n'en sont pas.
fn uv(table: &[(String, attrs::Attr<'_>)], corners: usize) -> Vec<f32> {
    table
        .iter()
        .find(|(name, attr)| {
            attr.domain == attrs::CORNER && attr.kind == attrs::FLOAT2 && !name.starts_with('.')
        })
        .map(|(_, attr)| attr.floats(corners, 2))
        .filter(|values| values.len() == corners * 2)
        .unwrap_or_default()
}
