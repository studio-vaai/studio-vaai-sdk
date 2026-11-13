use std::sync::Arc;

use api::{ApiClient, FinalizeBodyUploadBody, PrepareBodyUploadBody, PrepareBodyUploadResponse};
use state_machine::{BackendError, BodyId, HeightCm, Outcome, PhotoOutcome};

use super::outcomes::{classify_authenticated_api_error, failed};
use crate::image_metadata::ImageMetadata;

/// The host streams its prepared image and reports the credential for each API stage.
#[uniffi::export(with_foreign)]
#[async_trait::async_trait]
pub trait PhotoUploadHost: Send + Sync {
    fn credential_revision(&self) -> Option<u64>;
    async fn transfer(&self, request: PrepareBodyUploadResponse) -> bool;
}

/// Camera metadata belongs to the original photo, before any local resize.
#[derive(uniffi::Record)]
pub struct PhotoUploadMetadata {
    pub original: ImageMetadata,
    pub uploaded: Option<UploadedPhotoSize>,
}

#[derive(uniffi::Record)]
pub struct UploadedPhotoSize {
    pub width: u32,
    pub height: u32,
}

impl PhotoUploadMetadata {
    fn into_api(self) -> Option<api::ImageMetadata> {
        let original = self.original;
        let (uploaded_width, uploaded_height) = match self.uploaded {
            Some(size) => (
                Some(i32::try_from(size.width).ok()?),
                Some(i32::try_from(size.height).ok()?),
            ),
            None => (None, None),
        };
        Some(api::ImageMetadata {
            original_width: i32::try_from(original.original_width).ok()?,
            original_height: i32::try_from(original.original_height).ok()?,
            uploaded_width,
            uploaded_height,
            focal_length_mm: original.focal_length_mm.map(|value| value as f32),
            focal_length35mm: original.focal_length_35mm.map(|value| value as f32),
            focal_plane_x_resolution: original.focal_plane_x_resolution.map(|value| value as f32),
            focal_plane_y_resolution: original.focal_plane_y_resolution.map(|value| value as f32),
            focal_plane_resolution_unit: original.focal_plane_resolution_unit.map(i32::from),
        })
    }
}

/// Only finalizing a staged upload can create a body. The earlier steps can be retried safely.
#[uniffi::export]
pub async fn upload_experience_photo(
    client: Arc<ApiClient>,
    host: Arc<dyn PhotoUploadHost>,
    mime_type: String,
    byte_size: i64,
    image_metadata: Option<PhotoUploadMetadata>,
) -> Outcome {
    let Some(revision) = host.credential_revision() else {
        return Outcome::SessionExpired;
    };
    let prepared = client
        .prepare_body_upload(PrepareBodyUploadBody {
            content_type: mime_type.clone(),
            byte_size,
            file_name: None,
        })
        .await;
    if host.credential_revision().is_none() {
        return Outcome::SessionExpired;
    }
    let upload = match prepared {
        Ok(upload) => upload,
        Err(error) => return classify_authenticated_api_error(error, false, revision),
    };
    let staging_key = upload.staging_key.clone();
    if !host.transfer(upload).await {
        return failed(BackendError::Unavailable);
    }
    let Some(revision) = host.credential_revision() else {
        return Outcome::SessionExpired;
    };
    let result = client
        .create_body(FinalizeBodyUploadBody {
            staging_key,
            mime_type,
            image_metadata: image_metadata.and_then(PhotoUploadMetadata::into_api),
        })
        .await;
    if host.credential_revision().is_none() {
        return Outcome::SessionExpired;
    }
    match result {
        Ok(result) => match BodyId::try_from(result.body.body_id) {
            Ok(body_id) => PhotoOutcome::Accepted {
                body_id,
                estimated_height: HeightCm(f64::from(result.body.estimated_height_cm)),
            }
            .into(),
            Err(_) => Outcome::Unknown,
        },
        Err(error) => classify_authenticated_api_error(error, true, revision),
    }
}
