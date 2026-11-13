use std::sync::Arc;

use api::{ApiClient, ApiError, ProductDetails};
use state_machine::ProductId;

#[derive(uniffi::Enum)]
pub enum ExperienceProductLookup {
    Id { product_id: String },
    ForeignId { foreign_id: String },
}

/// The host applies this budget to either catalogue read.
#[uniffi::export]
pub fn experience_product_timeout_ms() -> u32 {
    30_000
}

#[allow(clippy::result_large_err)]
#[uniffi::export]
pub async fn lookup_experience_product(
    client: Arc<ApiClient>,
    lookup: ExperienceProductLookup,
) -> Result<ProductDetails, ApiError> {
    let (details, expected) = match lookup {
        ExperienceProductLookup::Id { product_id } => {
            let expected =
                ProductId::try_from(product_id).map_err(|_| ApiError::InvalidRequest {
                    reason: "Invalid try-on product ID.".into(),
                })?;
            (
                client.get_product_details(expected.into()).await?,
                Some(expected),
            )
        }
        ExperienceProductLookup::ForeignId { foreign_id } => {
            (client.get_product_by_foreign_id(foreign_id).await?, None)
        }
    };
    let actual = ProductId::try_from(details.product_id.clone()).ok();
    if actual.is_none() || expected.is_some_and(|id| actual != Some(id)) {
        return Err(ApiError::Decode {
            status: 200,
            reason: "The response did not identify the requested try-on product.".into(),
        });
    }
    Ok(details)
}
