//! JPEG XL decoding, for native hosts whose platform cannot decode it.
//!
//! The API keeps a body's source photo as JPEG XL, and a restored session
//! shows it from the API's signed URL. Browsers and Apple platforms decode
//! it themselves; Android does not, so the Flutter SDK decodes it here
//! (with `jxl-oxide`, in pure Rust). The WebAssembly build leaves it out:
//! the browser decodes the image.

/// A decoded image: 8-bit sRGB samples with alpha, row by row.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct DecodedImage {
    pub width: u32,
    pub height: u32,
    /// `width × height × 4` bytes: red, green, blue, alpha.
    pub rgba: Vec<u8>,
}

/// Decodes a JPEG XL image (a bare codestream or the ISO container) to
/// sRGB. `None` when the bytes are not JPEG XL, are malformed, or exceed the
/// size this decoder accepts, and always in the WebAssembly build.
#[uniffi::export]
pub fn decode_jpeg_xl(bytes: Vec<u8>) -> Option<DecodedImage> {
    #[cfg(not(target_arch = "wasm32"))]
    {
        native::decode(&bytes)
    }
    #[cfg(target_arch = "wasm32")]
    {
        let _ = bytes;
        None
    }
}

#[cfg(not(target_arch = "wasm32"))]
mod native {
    use jxl_oxide::{EnumColourEncoding, JxlImage, RenderingIntent};

    use super::DecodedImage;

    /// The largest image decoded, in pixels: a source photo is far smaller.
    const MAX_PIXELS: u64 = 50_000_000;

    pub(super) fn decode(bytes: &[u8]) -> Option<DecodedImage> {
        let mut image = JxlImage::builder().read(bytes).ok()?;
        let (width, height) = (image.width(), image.height());
        if width == 0 || height == 0 || u64::from(width) * u64::from(height) > MAX_PIXELS {
            return None;
        }
        image.request_color_encoding(EnumColourEncoding::srgb(RenderingIntent::Relative));
        let render = image.render_frame(0).ok()?;
        let mut stream = render.stream();
        let channels = stream.channels() as usize;
        let (w, h) = (stream.width() as usize, stream.height() as usize);
        let mut samples = vec![0u8; w * h * channels];
        stream.write_to_buffer(&mut samples);
        let rgba = match channels {
            4 => samples,
            3 => samples
                .as_chunks::<3>()
                .0
                .iter()
                .flat_map(|&[r, g, b]| [r, g, b, 255])
                .collect(),
            2 => samples
                .as_chunks::<2>()
                .0
                .iter()
                .flat_map(|&[g, a]| [g, g, g, a])
                .collect(),
            1 => samples.iter().flat_map(|&g| [g, g, g, 255]).collect(),
            _ => return None,
        };
        Some(DecodedImage {
            width: u32::try_from(w).ok()?,
            height: u32::try_from(h).ok()?,
            rgba,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A lossless 4 × 3 gradient (`cjxl -d 0`): red = 60·x, green = 100·y, blue = 200.
    const GRADIENT: [u8; 60] = [
        0xff, 0x0a, 0x10, 0x30, 0x10, 0x09, 0x08, 0x04, 0x01, 0x00, 0xc0, 0x00, 0x4b, 0x18, 0x93,
        0x8e, 0x83, 0x83, 0x84, 0x13, 0x54, 0x27, 0x8a, 0x30, 0xee, 0xf7, 0x02, 0xc1, 0x00, 0x08,
        0x0f, 0x0f, 0xbf, 0xb3, 0xf0, 0xf0, 0xf0, 0x3b, 0x0b, 0x0f, 0x0f, 0xd7, 0xdd, 0xdd, 0xfd,
        0x23, 0x7d, 0xa7, 0xfb, 0x20, 0x71, 0x90, 0x00, 0x30, 0x33, 0x0f, 0x33, 0xf3, 0x30, 0x33,
    ];

    #[test]
    fn decodes_a_jpeg_xl_codestream_to_rgba() {
        let image = decode_jpeg_xl(GRADIENT.to_vec()).expect("decodes");
        assert_eq!((image.width, image.height), (4, 3));
        assert_eq!(image.rgba.len(), 4 * 3 * 4);
        let pixel = |x: usize, y: usize| &image.rgba[(y * 4 + x) * 4..][..4];
        assert_eq!(pixel(0, 0), [0, 0, 200, 255]);
        assert_eq!(pixel(3, 2), [180, 200, 200, 255]);
    }

    #[test]
    fn other_bytes_are_not_jpeg_xl() {
        assert_eq!(decode_jpeg_xl(b"\x89PNG\r\n\x1a\n".to_vec()), None);
        assert_eq!(decode_jpeg_xl(Vec::new()), None);
    }
}
