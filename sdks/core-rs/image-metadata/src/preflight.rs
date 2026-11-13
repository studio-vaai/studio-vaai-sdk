//! Conservative admission checks for local pixel decoders.

use std::future::Future;

use super::{MAX_IMAGE_BYTES, MAX_METADATA_BYTES, PixelDimensions, bounded_dimensions};

const MAX_BOXES: usize = 4096;
const MAX_ITEMS: u32 = 256;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Rejection {
    ByteSize,
    Dimensions,
    Animation,
    TooManyItems,
}

type Inspection = Result<Option<PixelDimensions>, Rejection>;

pub fn validate_size(size: usize) -> Result<(), Rejection> {
    if (1..=MAX_IMAGE_BYTES).contains(&size) {
        Ok(())
    } else {
        Err(Rejection::ByteSize)
    }
}

pub fn validate_dimensions(width: u32, height: u32) -> Result<PixelDimensions, Rejection> {
    bounded_dimensions(width, height).ok_or(Rejection::Dimensions)
}

pub async fn inspect<F: Future<Output = Vec<u8>>>(
    size: usize,
    mut read: impl FnMut(usize, usize) -> F,
) -> Inspection {
    validate_size(size)?;
    let probe = read(0, size.min(16)).await;
    if probe.len() >= 16 && probe.get(4..8) == Some(b"ftyp") {
        inspect_heif(size, read).await
    } else {
        let length = size.min(MAX_METADATA_BYTES);
        let prefix = read(0, length).await;
        if prefix.len() == length {
            inspect_prefix(&prefix)
        } else {
            Ok(None)
        }
    }
}

fn inspect_prefix(bytes: &[u8]) -> Inspection {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        png(bytes)
    } else if bytes.starts_with(b"\xff\xd8") {
        jpeg(bytes)
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        webp(bytes)
    } else {
        Ok(None)
    }
}

fn png(mut bytes: &[u8]) -> Inspection {
    bytes = &bytes[8..];
    let mut dimensions = None;
    while let Some(header) = bytes.get(..8) {
        let length = be_u32(header) as usize;
        let kind = &header[4..8];
        if matches!(kind, b"IDAT" | b"IEND") {
            return Ok(dimensions);
        }
        let Some(chunk) = bytes[8..].get(..length) else {
            break;
        };
        if bytes.len() - 8 - length < 4 {
            break;
        }
        if kind == b"IHDR" && length == 13 {
            dimensions = Some(validate_dimensions(be_u32(chunk), be_u32(&chunk[4..]))?);
        }
        if kind == b"acTL" && length >= 8 && be_u32(chunk) != 1 {
            return Err(Rejection::Animation);
        }
        bytes = &bytes[12 + length..];
    }
    Ok(None)
}

fn jpeg(mut bytes: &[u8]) -> Inspection {
    bytes = &bytes[2..];
    let mut dimensions = None;
    while let [255, marker, rest @ ..] = bytes {
        match marker {
            255 => bytes = &bytes[1..],
            218 | 217 => return Ok(dimensions),
            1 | 208..=215 => bytes = rest,
            _ => {
                let Some(length) = rest.get(..2).map(be_u16).map(usize::from) else {
                    break;
                };
                if length < 2 || length > rest.len() {
                    break;
                }
                if matches!(marker, 192..=195 | 197..=199 | 201..=203 | 205..=207) {
                    if length < 8 || dimensions.is_some() {
                        break;
                    }
                    dimensions = Some(validate_dimensions(
                        u32::from(be_u16(&rest[5..])),
                        u32::from(be_u16(&rest[3..])),
                    )?);
                }
                bytes = &rest[length..];
            }
        }
    }
    Ok(None)
}

fn webp(mut bytes: &[u8]) -> Inspection {
    bytes = &bytes[12..];
    let mut dimensions = None;
    while let Some(header) = bytes.get(..8) {
        let length = le_u32(&header[4..]) as usize;
        let Some(chunk) = bytes.get(8..8 + length.min(10)) else {
            break;
        };
        match &header[..4] {
            b"ANIM" => return Err(Rejection::Animation),
            b"VP8X" if chunk.first().is_some_and(|flags| flags & 2 != 0) => {
                return Err(Rejection::Animation);
            }
            b"VP8X" if chunk.len() == 10 => {
                dimensions = Some(validate_dimensions(
                    1 + (le_u32(&chunk[4..]) & 0xff_ffff),
                    1 + (le_u32(&chunk[6..]) >> 8),
                )?);
            }
            b"VP8 " if chunk.len() == 10 && chunk[3..6] == [157, 1, 42] => {
                let frame = validate_dimensions(
                    u32::from(u16::from_le_bytes([chunk[6], chunk[7]]) & 0x3fff),
                    u32::from(u16::from_le_bytes([chunk[8], chunk[9]]) & 0x3fff),
                )?;
                return Ok(dimensions.or(Some(frame)));
            }
            b"VP8L" if chunk.len() >= 5 && chunk[0] == 47 => {
                let bits = le_u32(&chunk[1..]);
                let frame = validate_dimensions(1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff))?;
                return Ok(dimensions.or(Some(frame)));
            }
            _ => {}
        }
        let Some(rest) = bytes
            .get(8..)
            .and_then(|rest| rest.get(length..))
            .and_then(|rest| rest.get(length % 2..))
        else {
            break;
        };
        bytes = rest;
    }
    Ok(None)
}

#[derive(Clone, Copy)]
struct BoxHeader {
    kind: [u8; 4],
    header: usize,
    length: usize,
}

impl BoxHeader {
    fn read(bytes: &[u8], remaining: usize) -> Option<Self> {
        let kind = bytes.get(4..8)?.try_into().ok()?;
        let (header, length) = match be_u32(bytes) {
            0 => (8, remaining),
            1 => (
                16,
                usize::try_from(u64::from_be_bytes(bytes.get(8..16)?.try_into().ok()?)).ok()?,
            ),
            length => (8, length as usize),
        };
        (header <= length && length <= remaining).then_some(Self {
            kind,
            header,
            length,
        })
    }
}

async fn inspect_heif<F: Future<Output = Vec<u8>>>(
    size: usize,
    mut read: impl FnMut(usize, usize) -> F,
) -> Inspection {
    let mut offset = 0;
    let mut visited = 0;
    let mut budget = MAX_METADATA_BYTES - 16;
    let mut file_type = false;
    let mut metadata = None;
    while offset < size {
        let header_bytes = (size - offset).min(16);
        if visited == MAX_BOXES || header_bytes > budget {
            return Ok(None);
        }
        let bytes = read(offset, header_bytes).await;
        budget -= header_bytes;
        visited += 1;
        let Some(header) = BoxHeader::read(&bytes, size - offset) else {
            return Ok(None);
        };
        let BoxHeader {
            kind,
            header: prefix,
            length,
        } = header;
        if offset == 0 && kind != *b"ftyp" {
            return Ok(None);
        }
        match &kind {
            b"ftyp"
                if offset == 0 && length >= prefix + 8 && length <= 4096 && length <= budget =>
            {
                let bytes = read(offset, length).await;
                if bytes.len() != length
                    || bytes[prefix..]
                        .as_chunks::<4>()
                        .0
                        .iter()
                        .any(|brand| matches!(brand, b"msf1" | b"hevc" | b"hevx" | b"avis"))
                {
                    return Ok(None);
                }
                budget -= length;
                file_type = true;
            }
            b"meta" if metadata.is_none() && length <= budget => {
                let bytes = read(offset, length).await;
                if bytes.len() != length || bytes.get(prefix) != Some(&0) || length < prefix + 4 {
                    return Ok(None);
                }
                budget -= length;
                metadata = Some((bytes, prefix + 4));
            }
            b"mdat" | b"free" | b"skip" | b"wide" => {}
            _ => return Ok(None),
        }
        offset += length;
    }
    if let (true, Some((bytes, start))) = (file_type, metadata) {
        let mut dimensions = None;
        // Reserve the two top-level metadata boxes also visited by the nested check.
        visited += 2;
        if visited <= MAX_BOXES
            && image_properties(&bytes[start..], &mut visited, 1, &mut dimensions)?
        {
            return Ok(dimensions);
        }
    }
    Ok(None)
}

fn image_properties(
    mut bytes: &[u8],
    visited: &mut usize,
    depth: usize,
    dimensions: &mut Option<PixelDimensions>,
) -> Result<bool, Rejection> {
    if depth > 8 {
        return Ok(false);
    }
    while !bytes.is_empty() {
        *visited += 1;
        if *visited > MAX_BOXES {
            return Ok(false);
        }
        let Some(header) = BoxHeader::read(bytes, bytes.len()) else {
            return Ok(false);
        };
        let payload = &bytes[header.header..header.length];
        match &header.kind {
            b"mdat" | b"meta" | b"moov" => return Ok(false),
            b"iprp" | b"ipco" if !image_properties(payload, visited, depth + 1, dimensions)? => {
                return Ok(false);
            }
            b"ispe" => {
                if payload.len() < 12 {
                    return Ok(false);
                }
                let candidate = validate_dimensions(be_u32(&payload[4..]), be_u32(&payload[8..]))?;
                if dimensions.is_none_or(|size| {
                    candidate.width * candidate.height > size.width * size.height
                }) {
                    *dimensions = Some(candidate);
                }
            }
            b"iinf" => {
                if payload.len() < 8 {
                    return Ok(false);
                }
                let count = if payload[0] == 0 {
                    u32::from(be_u16(&payload[4..]))
                } else {
                    be_u32(&payload[4..])
                };
                if count > MAX_ITEMS {
                    return Err(Rejection::TooManyItems);
                }
            }
            _ => {}
        }
        bytes = &bytes[header.length..];
    }
    Ok(true)
}

fn be_u16(bytes: &[u8]) -> u16 {
    u16::from_be_bytes([bytes[0], bytes[1]])
}

fn be_u32(bytes: &[u8]) -> u32 {
    u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
}

fn le_u32(bytes: &[u8]) -> u32 {
    u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
}
