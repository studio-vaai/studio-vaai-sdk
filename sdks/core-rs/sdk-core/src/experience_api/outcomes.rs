use api::{
    ApiError, ApiProblem, BodyNotFoundProblemKind, BodyValidationCode,
    SessionUnauthorizedProblemKind, TryOnNotFoundProblemKind,
};
use state_machine::{
    BackendError, ForeignIds, Outcome, PhotoOutcome, PhotoRejection, RefusalReason, TryOnOutcome,
};

pub(super) fn failed(error: BackendError) -> Outcome {
    Outcome::Failed { error }
}

#[uniffi::export]
pub fn credential_rejected(error: ApiError) -> bool {
    is_auth_error(&error)
}

fn is_auth_error(error: &ApiError) -> bool {
    matches!(
        error,
        ApiError::Problem { problem: ApiProblem::SessionUnauthorizedProblem { problem }, .. }
            if matches!(problem.kind,
                SessionUnauthorizedProblemKind::SessionTokenRequired
                | SessionUnauthorizedProblemKind::SessionInvalid
                | SessionUnauthorizedProblemKind::SessionExpired)
    )
}

/// Classify a response at the write boundary of the request that produced it.
#[uniffi::export]
pub fn classify_experience_api_error(error: ApiError, writes: bool) -> Outcome {
    if is_auth_error(&error) {
        return Outcome::SessionExpired;
    }
    let status = match error {
        ApiError::InvalidRequest { .. } => return failed(BackendError::InvalidRequest),
        ApiError::NotSent { .. } => return failed(BackendError::Unavailable),
        ApiError::Transport { .. } => {
            return if writes {
                Outcome::Unknown
            } else {
                failed(BackendError::Unavailable)
            };
        }
        ApiError::Problem { status, problem } => {
            if let Some(outcome) = classify_problem(problem) {
                return outcome;
            }
            status
        }
        ApiError::Decode { status, .. } | ApiError::UnexpectedStatus { status, .. } => status,
    };
    match status {
        200..=299 | 408 | 502 | 504 if writes => Outcome::Unknown,
        404 => failed(BackendError::NotFound),
        429 | 503 => failed(BackendError::Unavailable),
        400..=499 => failed(BackendError::InvalidRequest),
        _ => failed(BackendError::Internal),
    }
}

pub(super) fn classify_authenticated_api_error(
    error: ApiError,
    writes: bool,
    revision: u64,
) -> Outcome {
    match classify_experience_api_error(error, writes) {
        Outcome::SessionExpired => Outcome::CredentialRejected { revision },
        outcome => outcome,
    }
}

fn classify_problem(problem: ApiProblem) -> Option<Outcome> {
    let outcome = match problem {
        ApiProblem::BodyNotFoundProblem { problem }
            if problem.kind == BodyNotFoundProblemKind::BodyNotFound =>
        {
            failed(BackendError::BodyNotFound)
        }
        ApiProblem::TryOnNotFoundProblem { problem }
            if problem.kind == TryOnNotFoundProblemKind::BodyNotFound =>
        {
            failed(BackendError::BodyNotFound)
        }
        ApiProblem::BodyValidationFailed { problem } => {
            let reason = match problem.reason {
                BodyValidationCode::NoHumanDetected => PhotoRejection::NoHumanDetected,
                BodyValidationCode::HumanOccluded => PhotoRejection::HumanOccluded,
                BodyValidationCode::HumanNotStanding => PhotoRejection::HumanNotStanding,
                BodyValidationCode::HumanTooSmall => PhotoRejection::HumanTooSmall,
                BodyValidationCode::InappropriateClothing => PhotoRejection::InappropriateClothing,
                BodyValidationCode::Unknown { .. } => return Some(failed(BackendError::Unusable)),
            };
            PhotoOutcome::Rejected { reason }.into()
        }
        ApiProblem::TryOnGarmentTooSmall { problem } => refused(
            RefusalReason::GarmentTooSmall,
            problem.recommended_foreign_ids,
        ),
        ApiProblem::TryOnGarmentTooLarge { problem } => refused(
            RefusalReason::GarmentTooLarge,
            problem.recommended_foreign_ids,
        ),
        ApiProblem::BodyUnusableProblem { .. }
        | ApiProblem::BodyHeightUnusableProblem { .. }
        | ApiProblem::SizeRecommendationUnavailableProblem { .. } => failed(BackendError::Unusable),
        _ => return None,
    };
    Some(outcome)
}

fn refused(
    reason: RefusalReason,
    alternative: Option<std::collections::HashMap<String, String>>,
) -> Outcome {
    match alternative {
        Some(alternative) => TryOnOutcome::RefusedWithAlternative {
            reason,
            alternative: foreign_ids(alternative),
        },
        None => TryOnOutcome::Refused { reason },
    }
    .into()
}

pub(super) fn foreign_ids(ids: std::collections::HashMap<String, String>) -> ForeignIds {
    ids.into_iter()
        .map(|(key, item)| (key.into(), item.into()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_submitted_write_can_be_uncertain_after_transport_failure() {
        let reason = "deadline".to_owned();
        assert!(matches!(
            classify_experience_api_error(
                ApiError::NotSent {
                    reason: reason.clone()
                },
                true
            ),
            Outcome::Failed {
                error: BackendError::Unavailable
            }
        ));
        assert!(matches!(
            classify_experience_api_error(ApiError::Transport { reason }, true),
            Outcome::Unknown
        ));
    }
}
