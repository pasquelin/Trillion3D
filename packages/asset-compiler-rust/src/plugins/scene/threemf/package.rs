//! OPC relationship selection and admission of every ZIP entry before decompression.
use super::*;
use ::zip::ZipArchive;
use std::io::{Cursor, Read};
fn member(archive: &mut ZipArchive<Cursor<&[u8]>>, name: &str, limit: usize) -> Result<Vec<u8>> {
    let mut file = archive
        .by_name(name)
        .map_err(|e| source::invalid("3mf", e))?;
    source::admit(
        usize::try_from(file.size()).unwrap_or(usize::MAX),
        limit,
        "3mf",
    )?;
    let mut bytes = Vec::new();
    Read::by_ref(&mut file)
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| source::invalid("3mf", e))?;
    source::admit(bytes.len(), limit, "3mf")?;
    Ok(bytes)
}
pub(super) fn model(bytes: &[u8], request: &SceneRequest<'_>) -> Result<Vec<u8>> {
    let mut archive = ZipArchive::new(Cursor::new(bytes)).map_err(|e| source::invalid("3mf", e))?;
    source::admit(
        archive.len().saturating_mul(256),
        request.ram_budget / 8,
        "3mf",
    )?;
    let mut names = BTreeSet::new();
    let mut total = 0usize;
    for index in 0..archive.len() {
        super::super::archive::check(request)?;
        let entry = archive
            .by_index(index)
            .map_err(|e| source::invalid("3mf", e))?;
        super::super::archive::safe_join(std::path::Path::new("package"), entry.name())?;
        if entry.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000) {
            return Err(source::invalid("3mf", "symbolic link in package"));
        }
        if !names.insert(entry.name().to_string()) {
            return Err(source::invalid("3mf", "duplicate package part"));
        }
        total = total
            .checked_add(usize::try_from(entry.size()).unwrap_or(usize::MAX))
            .ok_or_else(|| source::invalid("3mf", "decompressed size overflow"))?;
        source::admit(total, request.ram_budget / 4, "3mf")?;
    }
    let relationships = member(&mut archive, "_rels/.rels", request.ram_budget / 8)?;
    let document = xml::parse(&relationships, request, "3mf")?;
    let mut target = None;
    for relation in document
        .root_element()
        .children()
        .filter(|n| n.has_tag_name("Relationship"))
    {
        if relation.attribute("Type")
            == Some("http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel")
        {
            if target.is_some() {
                return Err(source::invalid("3mf", "multiple root model relationships"));
            }
            if relation
                .attribute("TargetMode")
                .is_some_and(|v| v != "Internal")
            {
                return Err(source::unsupported("3mf", "external model relationship"));
            }
            let name = relation
                .attribute("Target")
                .ok_or_else(|| source::invalid("3mf", "model relationship has no target"))?
                .trim_start_matches('/');
            super::super::archive::safe_join(std::path::Path::new("package"), name)?;
            target = Some(name.to_string());
        }
    }
    let target = target.ok_or_else(|| source::invalid("3mf", "no root3dmodel relationship"))?;
    member(&mut archive, &target, request.ram_budget / 8)
}
