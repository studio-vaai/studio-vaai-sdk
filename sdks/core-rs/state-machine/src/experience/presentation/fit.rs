use crate::{Fit, FitAxis, ResultFit, TryOn};

#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct ResultFitCallout {
    pub key: String,
    pub x: f64,
    pub y: f64,
    pub label: String,
    pub fit: Fit,
    pub is_length: bool,
}

#[cfg_attr(feature = "uniffi", uniffi::export)]
pub fn result_fit_callouts(result: TryOn) -> Vec<ResultFitCallout> {
    let Some(ResultFit::Ready { axes, .. }) = result.fit else {
        return Vec::new();
    };
    result
        .fit_anchors
        .into_iter()
        .flatten()
        .filter_map(|anchor| {
            let measurement = axes
                .iter()
                .find(|axis| axis.dimension.as_deref() == Some(&anchor.dimension))?;
            Some(ResultFitCallout {
                key: format!(
                    "{}:{}",
                    anchor.dimension,
                    anchor.side.as_deref().unwrap_or_default()
                ),
                x: anchor.x,
                y: anchor.y,
                label: measurement.label.clone()?,
                fit: measurement.fit,
                is_length: matches!(
                    measurement.axis,
                    FitAxis::TotalLength | FitAxis::SleeveLength | FitAxis::Inseam
                ),
            })
        })
        .collect()
}
