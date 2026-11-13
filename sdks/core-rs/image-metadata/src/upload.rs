//! Shared encoding policy for an admitted photo after decoding and orientation.

use super::PixelDimensions;

const MAX_UPLOAD_EDGE: u32 = 2_600;
const UPLOAD_JPEG_QUALITY: f64 = 0.9;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum EncodingPlan {
    Original,
    ResizeJpeg { size: PixelDimensions, quality: f64 },
}

pub fn encoding_plan(decoded: Option<PixelDimensions>) -> EncodingPlan {
    let Some(size) = decoded else {
        return EncodingPlan::Original;
    };
    let edge = size.width.max(size.height);
    if edge <= MAX_UPLOAD_EDGE {
        return EncodingPlan::Original;
    }
    let scale = f64::from(MAX_UPLOAD_EDGE) / f64::from(edge);
    let scale_edge = |value| (f64::from(value) * scale).round().max(1.0) as u32;
    EncodingPlan::ResizeJpeg {
        size: PixelDimensions {
            width: scale_edge(size.width),
            height: scale_edge(size.height),
        },
        quality: UPLOAD_JPEG_QUALITY,
    }
}
