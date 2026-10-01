//! Bounded top-level chunks; unknown extensions are reported, not mistaken for geometry.
use super::*;
pub(super) fn read(
    bytes: &[u8],
    request: &SceneRequest<'_>,
    scene: &mut SceneTables,
    doc: &mut Document,
) -> Result<()> {
    let mut all = Reader::new(bytes);
    let mut count = 0;
    while all.remaining() > 0 {
        if super::super::cancel::stopped(request.cancelled, count) {
            return Err(super::super::cancel::refusal());
        }
        count += 1;
        let tag = all.take(4)?;
        let size = all.u32()? as usize;
        let children = all.u32()? as usize;
        let mut r = Reader::new(all.take(size)?);
        if children != 0 {
            return Err(source::unsupported("vox", "nested non-MAIN chunks"));
        }
        match tag {
            b"PACK" => {
                if doc.pack.replace(r.u32()?).is_some() {
                    return Err(source::invalid("vox", "duplicate PACK"));
                }
            }
            b"SIZE" => {
                doc.budget.charge(512)?;
                let size = [r.u32()?, r.u32()?, r.u32()?];
                if size.iter().any(|v| !(1..=256).contains(v)) || doc.size.replace(size).is_some() {
                    return Err(source::invalid("vox", "invalid or unpaired SIZE"));
                }
            }
            b"XYZI" => {
                let size = doc
                    .size
                    .take()
                    .ok_or_else(|| source::invalid("vox", "XYZI without SIZE"))?;
                let n = r.u32()? as usize;
                let data = r.take(
                    n.checked_mul(4)
                        .ok_or_else(|| source::invalid("vox", "voxel count overflow"))?,
                )?;
                doc.budget.charge(n.saturating_mul(4096))?;
                let mut voxels = Vec::with_capacity(n);
                for (index, value) in data.as_chunks::<4>().0.iter().enumerate() {
                    if super::super::cancel::stopped(request.cancelled, index) {
                        return Err(super::super::cancel::refusal());
                    }
                    if value[3] == 0 || (0..3).any(|i| value[i] as u32 >= size[i]) {
                        return Err(source::invalid(
                            "vox",
                            "voxel outside SIZE or palette index zero",
                        ));
                    }
                    voxels.push(*value);
                }
                doc.models.push(Model { size, voxels });
            }
            b"RGBA" => {
                let mut colors = [[0; 4]; 256];
                for color in &mut colors[1..] {
                    *color = r.take(4)?.try_into().unwrap();
                }
                r.take(4)?;
                if doc.palette.replace(colors).is_some() {
                    return Err(source::invalid("vox", "duplicate palette"));
                }
            }
            b"MATL" => {
                let id = r.u32()?;
                if !(1..=255).contains(&id)
                    || doc.materials.insert(id, r.dict(&mut doc.budget)?).is_some()
                {
                    return Err(source::invalid("vox", "duplicate or invalid material"));
                }
            }
            b"nTRN" | b"nGRP" | b"nSHP" => graph::read_node(tag, &mut r, doc)?,
            b"LAYR" => {
                doc.budget.charge(2048)?;
                let id = r.i32()?;
                let attrs = r.dict(&mut doc.budget)?;
                if id < 0 || r.i32()? != -1 || doc.layers.insert(id, attrs).is_some() {
                    return Err(source::invalid("vox", "invalid layer"));
                }
            }
            b"MATT" | b"IMAP" => {
                return Err(source::unsupported("vox", String::from_utf8_lossy(tag)))
            }
            _ => {
                scene.report.add("vox-unknown-chunk");
                continue;
            }
        }
        r.finish()?;
    }
    Ok(())
}
