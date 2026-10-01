//! Walk bounded ISO-BMFF boxes, never search coded pixels for metadata byte patterns.
use super::super::Transfer;
use super::associations::Associations;

pub(super) fn read(bytes: &[u8]) -> Result<(Transfer, Vec<&'static str>), &'static str> {
    let mut properties = (Transfer::Srgb, Vec::new());
    let mut associations = Associations::default();
    boxes(bytes, 0, false, &mut properties, &mut associations)?;
    associations.validate()?;
    Ok(properties)
}

fn boxes(
    mut bytes: &[u8],
    depth: usize,
    property_list: bool,
    properties: &mut (Transfer, Vec<&'static str>),
    associations: &mut Associations,
) -> Result<(), &'static str> {
    if depth > 4 {
        return Err("image-decode-failed");
    }
    let mut index = 0;
    while !bytes.is_empty() {
        index += 1;
        let header = bytes.get(..8).ok_or("image-decode-failed")?;
        let short = u32::from_be_bytes(header[..4].try_into().unwrap());
        let (size, prefix) = match short {
            0 => (bytes.len(), 8),
            1 => {
                let field = bytes.get(8..16).ok_or("image-decode-failed")?;
                let size = usize::try_from(u64::from_be_bytes(field.try_into().unwrap()))
                    .map_err(|_| "image-decode-failed")?;
                (size, 16)
            }
            n => (n as usize, 8),
        };
        if size < prefix {
            return Err("image-decode-failed");
        }
        let payload = bytes.get(prefix..size).ok_or("image-decode-failed")?;
        match &header[4..8] {
            b"ftyp" => {
                if payload.len() < 8 {
                    return Err("image-decode-failed");
                }
                if &payload[..4] == b"avis"
                    || payload[8..].as_chunks::<4>().0.iter().any(|v| v == b"avis")
                {
                    return Err("image-animation-unsupported");
                }
            }
            b"moov" => return Err("image-animation-unsupported"),
            b"meta" => boxes(
                payload.get(4..).ok_or("image-decode-failed")?,
                depth + 1,
                false,
                properties,
                associations,
            )?,
            b"iprp" | b"ipco" => boxes(
                payload,
                depth + 1,
                &header[4..8] == b"ipco",
                properties,
                associations,
            )?,
            b"pitm" => associations.primary(payload)?,
            b"ipma" => associations.read(payload)?,
            // These transforms require association and pixel reordering; do not silently drop them.
            b"irot" | b"imir" | b"clap" => return Err("image-transform-unsupported"),
            b"colr" => {
                color(payload, properties)?;
                if property_list && payload.starts_with(b"nclx") {
                    associations.srgb.insert(index);
                }
            }
            _ => {}
        }
        bytes = &bytes[size..];
    }
    Ok(())
}

fn color(
    bytes: &[u8],
    _properties: &mut (Transfer, Vec<&'static str>),
) -> Result<(), &'static str> {
    match bytes.get(..4).ok_or("image-decode-failed")? {
        b"prof" | b"rICC" => return Err("image-profile-unsupported"),
        b"nclx" => {
            let fields = bytes.get(4..11).ok_or("image-decode-failed")?;
            let primaries = u16::from_be_bytes([fields[0], fields[1]]);
            let transfer = u16::from_be_bytes([fields[2], fields[3]]);
            if primaries != 1 {
                return Err("image-primaries-unsupported");
            }
            match transfer {
                13 => {}
                _ => return Err("image-transfer-unsupported"),
            }
        }
        _ => return Err("image-colour-description-unsupported"),
    }
    Ok(())
}
