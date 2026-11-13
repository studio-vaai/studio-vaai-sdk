//! Image metadata: what body estimation needs from a photo, read on the
//! device before a resize strips it.

/// Metadata from the *original* (pre-resize) photo.
///
/// Send it with the upload whenever the app downscales the photo first: the
/// resize strips the EXIF, and the server needs the original size and focal
/// length to estimate the body correctly. Add the uploaded image's size next
/// to it. Focal fields the photo doesn't carry are absent, and the server
/// falls back accordingly.
#[derive(Debug, Clone, Copy, PartialEq, uniffi::Record)]
pub struct ImageMetadata {
    /// Width of the original photo, in pixels.
    pub original_width: u32,
    /// Height of the original photo, in pixels.
    pub original_height: u32,
    /// EXIF `FocalLength`, in millimetres.
    pub focal_length_mm: Option<f64>,
    /// EXIF `FocalLengthIn35mmFilm`: the 35mm-equivalent focal length, in millimetres.
    pub focal_length_35mm: Option<f64>,
    /// EXIF `FocalPlaneXResolution`: pixels per `focal_plane_resolution_unit`.
    pub focal_plane_x_resolution: Option<f64>,
    /// EXIF `FocalPlaneYResolution`: pixels per `focal_plane_resolution_unit`.
    pub focal_plane_y_resolution: Option<f64>,
    /// EXIF `FocalPlaneResolutionUnit`: 2 = inch, 3 = centimetre.
    pub focal_plane_resolution_unit: Option<u16>,
}

impl From<image_metadata::ImageMetadata> for ImageMetadata {
    fn from(metadata: image_metadata::ImageMetadata) -> Self {
        let image_metadata::ImageMetadata {
            original: image_metadata::PixelDimensions { width, height },
            focal:
                image_metadata::FocalFields {
                    focal_length_mm,
                    focal_length_35mm,
                    focal_plane_x_resolution,
                    focal_plane_y_resolution,
                    focal_plane_resolution_unit,
                },
        } = metadata;
        Self {
            original_width: width,
            original_height: height,
            focal_length_mm,
            focal_length_35mm,
            focal_plane_x_resolution,
            focal_plane_y_resolution,
            focal_plane_resolution_unit,
        }
    }
}

/// Read [`ImageMetadata`] from the original photo's bytes (JPEG, HEIC/HEIF,
/// PNG, WebP or TIFF), without decoding its pixels. Absent when the photo's
/// size can't be read.
///
/// The bytes are borrowed for the call, not copied: Swift passes the `Data`'s
/// own memory and Kotlin a direct `ByteBuffer`. Only the header bytes are
/// read, so a memory-mapped photo is never paged in beyond them.
#[uniffi::export]
pub fn read_image_metadata(image: &[u8]) -> Option<ImageMetadata> {
    image_metadata::read_image_metadata(image).map(ImageMetadata::from)
}

use std::sync::Arc;

use image_metadata::preflight::{self, Rejection};

#[derive(uniffi::Record)]
pub struct PhotoInputLimits {
    pub input_bytes: u32,
    pub header_bytes: u32,
}

#[uniffi::export]
pub fn photo_input_limits() -> PhotoInputLimits {
    PhotoInputLimits {
        input_bytes: image_metadata::MAX_IMAGE_BYTES as u32,
        header_bytes: image_metadata::MAX_METADATA_BYTES as u32,
    }
}

#[derive(uniffi::Enum)]
pub enum PhotoInputRejection {
    ByteSize,
    Dimensions,
    Animation,
    TooManyItems,
}

impl From<Rejection> for PhotoInputRejection {
    fn from(reason: Rejection) -> Self {
        match reason {
            Rejection::ByteSize => Self::ByteSize,
            Rejection::Dimensions => Self::Dimensions,
            Rejection::Animation => Self::Animation,
            Rejection::TooManyItems => Self::TooManyItems,
        }
    }
}

#[uniffi::export]
pub fn photo_size_rejection(size: u32) -> Option<PhotoInputRejection> {
    preflight::validate_size(size as usize)
        .err()
        .map(Into::into)
}

#[uniffi::export]
pub fn photo_dimensions_rejection(width: u32, height: u32) -> Option<PhotoInputRejection> {
    preflight::validate_dimensions(width, height)
        .err()
        .map(Into::into)
}

#[derive(uniffi::Enum)]
pub enum PhotoHeader {
    Unknown,
    Still { width: u32, height: u32 },
    Rejected { reason: PhotoInputRejection },
}

/// Read just the requested bytes from the host's original file.
#[uniffi::export(with_foreign)]
#[async_trait::async_trait]
pub trait PhotoHeaderSource: Send + Sync {
    async fn read(&self, offset: u32, length: u32) -> Vec<u8>;
}

#[uniffi::export]
pub async fn inspect_photo_header(size: u32, source: Arc<dyn PhotoHeaderSource>) -> PhotoHeader {
    match preflight::inspect(size as usize, |offset, length| {
        source.read(offset as u32, length as u32)
    })
    .await
    {
        Ok(Some(size)) => PhotoHeader::Still {
            width: size.width,
            height: size.height,
        },
        Ok(None) => PhotoHeader::Unknown,
        Err(reason) => PhotoHeader::Rejected {
            reason: reason.into(),
        },
    }
}

#[derive(uniffi::Enum)]
pub enum PhotoEncodingPlan {
    Original,
    ResizeJpeg {
        width: u32,
        height: u32,
        quality: f64,
    },
}

/// Plan encoding from the dimensions reported by the host's oriented decoder.
#[uniffi::export]
pub fn photo_encoding_plan(
    decoded: Option<crate::experience_api::UploadedPhotoSize>,
) -> PhotoEncodingPlan {
    use image_metadata::upload::{EncodingPlan, encoding_plan};
    let decoded = decoded.map(|size| image_metadata::PixelDimensions {
        width: size.width,
        height: size.height,
    });
    match encoding_plan(decoded) {
        EncodingPlan::Original => PhotoEncodingPlan::Original,
        EncodingPlan::ResizeJpeg { size, quality } => PhotoEncodingPlan::ResizeJpeg {
            width: size.width,
            height: size.height,
            quality,
        },
    }
}
