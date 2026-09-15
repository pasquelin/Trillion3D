use super::*;

/// Écrit une page géométrique dans le magasin adressé par contenu et rend son entrée de manifeste.
///
/// Une page déjà présente et dont l'empreinte correspond n'est pas réécrite : deux compilations de
/// la même source partagent leurs objets, et le compteur de pages réutilisées le dit.
pub(super) fn store_page(
    o: &Options,
    slice: &[u32],
    pos: &[f32],
    page_attributes: &[geometry_page::Attribute],
) -> Result<(Value, bool)> {
    let (data, flags, vertex_count) = geometry_page::encode(slice, pos, page_attributes)?;
    let digest = hash(&data);
    let name = format!("../../objects/{}.bin", digest);
    let target = o
        .cache
        .join("native")
        .join("objects")
        .join(format!("{}.bin", digest));
    let reused = target.exists() && hash_file(&target)? == digest;
    if !reused {
        store_object(&target, &data)?;
    }
    Ok((
        json!({"url":name,"sha256":digest,"bytes":data.len(),"formatVersion":2,"codec":"meshopt","vertexCount":vertex_count,"indexCount":slice.len(),"flags":flags,"uncompressedBytes":vertex_count*geometry_page::STRIDE+slice.len()*2}),
        reused,
    ))
}
