//! Image metadata read from a photo's headers, without decoding pixels.
//!
//! What focal-length estimation needs from a photo: its pixel size and the
//! EXIF focal fields. An app reads them from the original photo, before a
//! resize strips the EXIF, and sends them with the upload.
//!
//! Untrusted input is size-bounded. Unreadable or incomplete metadata is absent.

pub mod preflight;
pub mod upload;

use std::io::Cursor;

use exif::{Exif, In, Tag, Value};

pub const MAX_IMAGE_BYTES: usize = 50 * 1024 * 1024;
pub const MAX_METADATA_BYTES: usize = 1024 * 1024;
const MAX_IMAGE_EDGE: u32 = 16_384;
const MAX_IMAGE_PIXELS: u64 = 64_000_000;

fn header_bytes(image: &[u8]) -> Option<&[u8]> {
    if image.is_empty() || image.len() > MAX_IMAGE_BYTES {
        return None;
    }
    Some(&image[..image.len().min(MAX_METADATA_BYTES)])
}

fn bounded_dimensions(width: u32, height: u32) -> Option<PixelDimensions> {
    (width > 0
        && height > 0
        && width <= MAX_IMAGE_EDGE
        && height <= MAX_IMAGE_EDGE
        && u64::from(width) * u64::from(height) <= MAX_IMAGE_PIXELS)
        .then_some(PixelDimensions { width, height })
}

/// A size in pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PixelDimensions {
    pub width: u32,
    pub height: u32,
}

/// The EXIF fields focal-length estimation reads. Each is `None` when the
/// image doesn't carry it. A client that resizes before upload sends these
/// out of band (they are the focal part of `ImageMetadataInput` in
/// the browser photo adapter).
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct FocalFields {
    /// `FocalLength`, in millimetres.
    pub focal_length_mm: Option<f64>,
    /// `FocalLengthIn35mmFilm`: the 35mm-equivalent focal length, in millimetres.
    pub focal_length_35mm: Option<f64>,
    /// `FocalPlaneXResolution`: pixels per `focal_plane_resolution_unit`.
    pub focal_plane_x_resolution: Option<f64>,
    /// `FocalPlaneYResolution`: pixels per `focal_plane_resolution_unit`.
    pub focal_plane_y_resolution: Option<f64>,
    /// `FocalPlaneResolutionUnit`: 2 = inch, 3 = centimetre.
    pub focal_plane_resolution_unit: Option<u16>,
}

/// The focal EXIF read from an image, with the size the camera recorded.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct FocalExif {
    pub fields: FocalFields,
    /// `PixelXDimension` × `PixelYDimension`: the size the camera says it
    /// recorded the image at, which the focal-plane resolution refers to.
    pub pixel_dimensions: Option<PixelDimensions>,
}

/// What a client sends alongside a resized upload: the original image's size
/// and its focal EXIF. The wire shape is `ImageMetadataInput` in
/// the browser photo adapter, less the uploaded size the caller adds after
/// resizing.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ImageMetadata {
    pub original: PixelDimensions,
    pub focal: FocalFields,
}

/// The pixel size an image's container header declares (JPEG frame, PNG
/// `IHDR`, HEIF `ispe`, WebP, TIFF, …), as stored, before any EXIF
/// orientation is applied.
pub fn read_pixel_dimensions(image: &[u8]) -> Option<PixelDimensions> {
    let size = imagesize::blob_size(header_bytes(image)?).ok()?;
    bounded_dimensions(
        u32::try_from(size.width).ok()?,
        u32::try_from(size.height).ok()?,
    )
}

/// Read the focal EXIF from an image's bytes (JPEG, HEIC/HEIF, PNG, WebP,
/// TIFF). Returns `None` when the image carries no readable EXIF block.
pub fn read_focal_exif(image: &[u8]) -> Option<FocalExif> {
    read_exif(image).map(|exif| focal_exif(&exif))
}

/// Read what a client sends with a resized upload from the *original* image.
///
/// The original size comes from the container header, falling back to EXIF
/// `PixelXDimension` / `PixelYDimension` and then the TIFF `ImageWidth` /
/// `ImageLength` tags — the same order as the web SDK's reader in
/// the browser photo adapter. Returns `None` when no size can be read;
/// focal fields the image lacks are `None`.
pub fn read_image_metadata(image: &[u8]) -> Option<ImageMetadata> {
    let exif = read_exif(image);
    let focal = exif.as_ref().map(focal_exif).unwrap_or_default();
    let original = read_pixel_dimensions(image)
        .or(focal.pixel_dimensions)
        .or_else(|| exif.as_ref().and_then(tiff_dimensions))?;
    Some(ImageMetadata {
        original,
        focal: focal.fields,
    })
}

fn focal_exif(exif: &Exif) -> FocalExif {
    FocalExif {
        fields: FocalFields {
            focal_length_mm: number(exif, Tag::FocalLength),
            focal_length_35mm: number(exif, Tag::FocalLengthIn35mmFilm),
            focal_plane_x_resolution: number(exif, Tag::FocalPlaneXResolution),
            focal_plane_y_resolution: number(exif, Tag::FocalPlaneYResolution),
            focal_plane_resolution_unit: unsigned(exif, Tag::FocalPlaneResolutionUnit)
                .and_then(|unit| u16::try_from(unit).ok()),
        },
        pixel_dimensions: dimensions(exif, Tag::PixelXDimension, Tag::PixelYDimension),
    }
}

/// Parse the EXIF block out of any supported container. Reads the container
/// framing only, so it is cheap on multi-megabyte photos.
fn read_exif(image: &[u8]) -> Option<Exif> {
    exif::Reader::new()
        .read_from_container(&mut Cursor::new(header_bytes(image)?))
        .ok()
}

fn tiff_dimensions(exif: &Exif) -> Option<PixelDimensions> {
    dimensions(exif, Tag::ImageWidth, Tag::ImageLength)
}

fn dimensions(exif: &Exif, width: Tag, height: Tag) -> Option<PixelDimensions> {
    let width = unsigned(exif, width)?;
    let height = unsigned(exif, height)?;
    bounded_dimensions(width, height)
}

fn unsigned(exif: &Exif, tag: Tag) -> Option<u32> {
    exif.get_field(tag, In::PRIMARY)?.value.get_uint(0)
}

/// The first component of a numeric field as `f64`, whatever its stored type.
/// Rationals are divided out; a zero denominator or any other non-finite
/// result reads as absent.
fn number(exif: &Exif, tag: Tag) -> Option<f64> {
    let value = match &exif.get_field(tag, In::PRIMARY)?.value {
        Value::Byte(items) => f64::from(*items.first()?),
        Value::Short(items) => f64::from(*items.first()?),
        Value::Long(items) => f64::from(*items.first()?),
        Value::Rational(items) => items.first()?.to_f64(),
        Value::SByte(items) => f64::from(*items.first()?),
        Value::SShort(items) => f64::from(*items.first()?),
        Value::SLong(items) => f64::from(*items.first()?),
        Value::SRational(items) => items.first()?.to_f64(),
        Value::Float(items) => f64::from(*items.first()?),
        Value::Double(items) => *items.first()?,
        _ => return None,
    };
    value.is_finite().then_some(value)
}

#[cfg(test)]
mod tests {
    //! The photos are built here, header by header, with known EXIF values:
    //! the readers never decode pixels, so a header is a complete fixture.

    use super::*;

    /// The EXIF a test photo carries. Rationals are `(numerator, denominator)`.
    #[derive(Clone, Copy)]
    struct TestExif {
        focal_length: (u32, u32),
        focal_length_35mm: u16,
        pixel_dimensions: (u32, u32),
        focal_plane: Option<FocalPlane>,
    }

    /// `FocalPlaneXResolution`, `FocalPlaneYResolution` and their unit.
    #[derive(Clone, Copy)]
    struct FocalPlane {
        x: (u32, u32),
        y: (u32, u32),
        unit: u16,
    }

    const IPHONE: TestExif = TestExif {
        focal_length: (6765, 1000),
        focal_length_35mm: 24,
        pixel_dimensions: (4032, 3024),
        focal_plane: None,
    };

    const CAMERA: TestExif = TestExif {
        focal_length: (35, 1),
        focal_length_35mm: 52,
        pixel_dimensions: (6000, 4000),
        focal_plane: Some(FocalPlane {
            x: (6000, 1),
            y: (6000, 1),
            unit: 2,
        }),
    };

    /// A little-endian TIFF block: IFD0 holding only the Exif IFD pointer,
    /// then the Exif IFD with the focal fields and the recorded size.
    fn tiff(exif: TestExif) -> Vec<u8> {
        const RATIONAL: u16 = 5;
        const SHORT: u16 = 3;
        const LONG: u16 = 4;
        let mut entries: Vec<(u16, u16, Vec<u8>)> = vec![
            (0x920A, RATIONAL, rational(exif.focal_length)),
            (0xA002, LONG, exif.pixel_dimensions.0.to_le_bytes().to_vec()),
            (0xA003, LONG, exif.pixel_dimensions.1.to_le_bytes().to_vec()),
            (0xA405, SHORT, exif.focal_length_35mm.to_le_bytes().to_vec()),
        ];
        if let Some(plane) = exif.focal_plane {
            entries.push((0xA20E, RATIONAL, rational(plane.x)));
            entries.push((0xA20F, RATIONAL, rational(plane.y)));
            entries.push((0xA210, SHORT, plane.unit.to_le_bytes().to_vec()));
        }
        entries.sort_by_key(|&(tag, ..)| tag);

        let ifd0_offset = 8u32;
        let exif_ifd_offset = ifd0_offset + 2 + 12 + 4;
        let ifd_len = |count: usize| 2 + 12 * count as u32 + 4;
        let mut data_offset = exif_ifd_offset + ifd_len(entries.len());

        let mut out = b"II*\0".to_vec();
        out.extend(ifd0_offset.to_le_bytes());
        out.extend(1u16.to_le_bytes());
        out.extend(ifd_entry(0x8769, LONG, &exif_ifd_offset.to_le_bytes()));
        out.extend(0u32.to_le_bytes());

        out.extend((entries.len() as u16).to_le_bytes());
        let mut data: Vec<u8> = Vec::new();
        for (tag, kind, value) in &entries {
            if value.len() <= 4 {
                out.extend(ifd_entry(*tag, *kind, value));
            } else {
                out.extend(ifd_entry(*tag, *kind, &data_offset.to_le_bytes()));
                data_offset += value.len() as u32;
                data.extend(value);
            }
        }
        out.extend(0u32.to_le_bytes());
        out.extend(data);
        out
    }

    fn rational((num, den): (u32, u32)) -> Vec<u8> {
        [num.to_le_bytes(), den.to_le_bytes()].concat()
    }

    fn ifd_entry(tag: u16, kind: u16, value: &[u8]) -> Vec<u8> {
        let mut entry = Vec::with_capacity(12);
        entry.extend(tag.to_le_bytes());
        entry.extend(kind.to_le_bytes());
        entry.extend(1u32.to_le_bytes());
        let mut field = [0u8; 4];
        field[..value.len()].copy_from_slice(value);
        entry.extend(field);
        entry
    }

    /// A JPEG: the EXIF in an APP1 segment, then a frame header of the given size.
    fn jpeg(width: u16, height: u16, exif: Option<TestExif>) -> Vec<u8> {
        let mut out = vec![0xFF, 0xD8];
        if let Some(exif) = exif {
            let payload = [b"Exif\0\0".as_slice(), &tiff(exif)].concat();
            out.extend([0xFF, 0xE1]);
            out.extend((payload.len() as u16 + 2).to_be_bytes());
            out.extend(payload);
        }
        out.extend([0xFF, 0xC0, 0x00, 0x0B, 0x08]);
        out.extend(height.to_be_bytes());
        out.extend(width.to_be_bytes());
        out.extend([0x01, 0x01, 0x11, 0x00]);
        out.extend([0xFF, 0xD9]);
        out
    }

    /// An ISO base media box.
    fn bmff(kind: &[u8; 4], body: &[u8]) -> Vec<u8> {
        [
            &(body.len() as u32 + 8).to_be_bytes(),
            kind.as_slice(),
            body,
        ]
        .concat()
    }

    /// A HEIC: the EXIF as an `Exif` item stored in `idat`, and the image size
    /// as an `ispe` property, the way phones write them.
    fn heic(width: u32, height: u32, exif: TestExif) -> Vec<u8> {
        let full = |version: u8| [version, 0, 0, 0];
        let item = [&0u32.to_be_bytes()[..], &tiff(exif)].concat();
        let ftyp = bmff(b"ftyp", b"heic\0\0\0\0mif1heic");
        let hdlr = bmff(
            b"hdlr",
            &[&full(0)[..], &[0; 4], b"pict", &[0; 13]].concat(),
        );
        let infe = bmff(
            b"infe",
            &[&full(2)[..], &1u16.to_be_bytes(), &[0, 0], b"Exif", b"\0"].concat(),
        );
        let iinf = bmff(
            b"iinf",
            &[&full(0)[..], &1u16.to_be_bytes(), &infe].concat(),
        );
        let iloc = bmff(
            b"iloc",
            &[
                &full(1)[..],
                &[0x44, 0x00],
                &1u16.to_be_bytes(),
                &1u16.to_be_bytes(),
                &[0x00, 0x01],
                &0u16.to_be_bytes(),
                &1u16.to_be_bytes(),
                &0u32.to_be_bytes(),
                &(item.len() as u32).to_be_bytes(),
            ]
            .concat(),
        );
        let idat = bmff(b"idat", &item);
        let ispe = bmff(
            b"ispe",
            &[&full(0)[..], &width.to_be_bytes(), &height.to_be_bytes()].concat(),
        );
        let iprp = bmff(b"iprp", &bmff(b"ipco", &ispe));
        let meta = bmff(
            b"meta",
            &[&full(0)[..], &hdlr, &iinf, &iloc, &idat, &iprp].concat(),
        );
        [ftyp, meta].concat()
    }

    /// A PNG with no EXIF: the signature, then the header chunk.
    fn png(width: u32, height: u32) -> Vec<u8> {
        let mut out = b"\x89PNG\r\n\x1a\n".to_vec();
        let ihdr = [
            &width.to_be_bytes()[..],
            &height.to_be_bytes(),
            &[8, 2, 0, 0, 0],
        ]
        .concat();
        out.extend(13u32.to_be_bytes());
        out.extend(b"IHDR");
        out.extend(ihdr);
        out.extend([0; 4]);
        out.extend(0u32.to_be_bytes());
        out.extend(b"IEND");
        out.extend([0; 4]);
        out
    }

    fn dimensions(width: u32, height: u32) -> PixelDimensions {
        PixelDimensions { width, height }
    }

    #[test]
    fn untrusted_dimensions_and_metadata_reads_are_bounded() {
        assert_eq!(
            read_pixel_dimensions(&png(8064, 6048)),
            Some(dimensions(8064, 6048))
        );
        assert_eq!(read_pixel_dimensions(&png(MAX_IMAGE_EDGE + 1, 1)), None);
        assert_eq!(
            read_image_metadata(&png(MAX_IMAGE_EDGE, MAX_IMAGE_EDGE)),
            None
        );
        let input = vec![0u8; MAX_METADATA_BYTES + 123];
        assert_eq!(header_bytes(&input).unwrap().len(), MAX_METADATA_BYTES);
        assert_eq!(read_focal_exif(&input), None);
        assert_eq!(header_bytes(&[]), None);
    }

    #[test]
    fn reads_focal_fields_and_size_from_a_jpeg() {
        let meta = read_image_metadata(&jpeg(4032, 3024, Some(CAMERA))).expect("metadata");
        assert_eq!(
            meta,
            ImageMetadata {
                original: dimensions(4032, 3024),
                focal: FocalFields {
                    focal_length_mm: Some(35.0),
                    focal_length_35mm: Some(52.0),
                    focal_plane_x_resolution: Some(6000.0),
                    focal_plane_y_resolution: Some(6000.0),
                    focal_plane_resolution_unit: Some(2),
                },
            }
        );
    }

    #[test]
    fn heic_and_jpeg_of_one_capture_agree() {
        let heic = read_image_metadata(&heic(4032, 3024, IPHONE)).expect("HEIC");
        let jpeg = read_image_metadata(&jpeg(4032, 3024, Some(IPHONE))).expect("JPEG");
        assert_eq!(heic, jpeg);
        assert_eq!(heic.original, dimensions(4032, 3024));
        assert_eq!(heic.focal.focal_length_mm, Some(6.765));
        assert_eq!(heic.focal.focal_length_35mm, Some(24.0));
    }

    #[test]
    fn container_size_wins_over_a_stale_exif_size() {
        // A resize that kept the EXIF leaves PixelXDimension at the capture size.
        let resized = jpeg(960, 720, Some(IPHONE));
        let meta = read_image_metadata(&resized).expect("metadata");
        assert_eq!(meta.original, dimensions(960, 720));
        let exif = read_focal_exif(&resized).expect("EXIF");
        assert_eq!(exif.pixel_dimensions, Some(dimensions(4032, 3024)));
    }

    #[test]
    fn image_without_exif_still_reports_its_size() {
        let photo = png(960, 1280);
        let meta = read_image_metadata(&photo).expect("PNG size");
        assert_eq!(meta.original, dimensions(960, 1280));
        assert_eq!(meta.focal, FocalFields::default());
        assert_eq!(read_focal_exif(&photo), None);
    }

    #[test]
    fn zero_denominator_reads_as_absent() {
        let broken = TestExif {
            focal_length: (6765, 0),
            ..IPHONE
        };
        let meta = read_image_metadata(&jpeg(4032, 3024, Some(broken))).expect("metadata");
        assert_eq!(meta.focal.focal_length_mm, None);
        assert_eq!(meta.focal.focal_length_35mm, Some(24.0));
    }

    #[test]
    fn garbage_and_truncated_input_read_as_absent() {
        assert_eq!(read_image_metadata(b"not an image"), None);
        assert_eq!(read_image_metadata(&[]), None);
        // Every prefix of a photo must parse or fail without panicking.
        for photo in [heic(4032, 3024, CAMERA), jpeg(4032, 3024, Some(CAMERA))] {
            for len in 0..photo.len() {
                let _ = read_image_metadata(&photo[..len]);
                let _ = read_focal_exif(&photo[..len]);
            }
        }
    }
}
