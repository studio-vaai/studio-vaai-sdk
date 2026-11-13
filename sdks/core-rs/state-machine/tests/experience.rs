//! The default experience, driven through the runtime.

mod common;

use common::*;
use state_machine::*;

fn picker_token(view: &FlowView) -> InteractionToken {
    match view.modal {
        Some(Modal::Picker { token }) => token,
        _ => panic!("no picker: {:?}", view.modal),
    }
}

fn camera_ready(f: &Fixture) {
    f.flow
        .dispatch(
            PhotoAction::BeginSource {
                source: PhotoSource::Camera,
            }
            .into(),
        )
        .unwrap();
    let CameraState::Acquiring { token } = *f.flow.view().unwrap().camera() else {
        panic!("no camera acquisition");
    };
    f.flow
        .complete_device(
            CameraEvent::Acquired {
                token,
                lease: id("camera-lease"),
                preview: None,
                devices: Some(CameraDevices {
                    selected: Some("front".into()),
                    available: vec!["front".into(), "rear".into()],
                }),
            }
            .into(),
        )
        .unwrap();
}

fn countdown_token(f: &Fixture) -> InteractionToken {
    match f.flow.view().unwrap().camera() {
        CameraState::Countdown { token, .. } => *token,
        other => panic!("no countdown: {other:?}"),
    }
}

fn finish_render(f: &Fixture, operation: OperationId, name: &str) {
    f.session
        .complete(Completion {
            operation,
            outcome: TryOnOutcome::Created {
                try_on_id: id(name),
                image_url: format!("https://example.invalid/{name}").into(),
            }
            .into(),
        })
        .unwrap();
}

fn renders(effects: &[Effect]) -> bool {
    effects.iter().any(|e| {
        matches!(
            e,
            Effect::DomainEffect {
                effect: DomainEffect::Start {
                    job: Job::TryOn {
                        job: TryOnJob::Create { .. }
                    },
                    ..
                }
            }
        )
    })
}

fn try_on_m(f: &Fixture) {
    f.flow
        .dispatch(PresentationAction::RequestTryOn.into())
        .unwrap();
    finish_render(f, render_effect(&f.driver), "M");
}

/// Back to the height, with a new height confirmed but not yet acknowledged.
fn pending_set_height(f: &Fixture) -> OperationId {
    f.flow.dispatch(NavigationAction::Back.into()).unwrap();
    f.flow
        .dispatch(
            HeightAction::Edit {
                height: HeightCm(180.0),
            }
            .into(),
        )
        .unwrap();
    f.flow.dispatch(HeightAction::Confirm.into()).unwrap();
    f.session
        .snapshot()
        .unwrap()
        .body
        .height()
        .and_then(HeightStatus::outstanding)
        .unwrap()
}

#[test]
fn picker_cancel_preserves_body_results_and_screen() {
    let f = Fixture::ready();
    try_on_m(&f);
    let before = f.session.snapshot().unwrap();
    replace_with_library(&f);
    let token = picker_token(&f.flow.view().unwrap());
    f.flow
        .complete_device(PickerEvent::Cancelled { token }.into())
        .unwrap();
    let view = f.flow.view().unwrap();
    assert!(matches!(view.screen, ScreenView::TryOn { .. }));
    // Nothing is left to cancel: the photo change ended with the picker.
    assert_eq!(view.photo_change, None);
    let after = f.session.snapshot().unwrap();
    assert_eq!(before.body, after.body);
    assert_eq!(before.try_ons(), after.try_ons());
}

#[test]
fn rejected_replacement_can_return_to_old_result() {
    let f = Fixture::ready();
    try_on_m(&f);
    replace_with_library(&f);
    let token = picker_token(&f.flow.view().unwrap());
    f.flow
        .complete_device(
            PickerEvent::Selected {
                token,
                media: id("bad"),
            }
            .into(),
        )
        .unwrap();
    let Some(NewPhoto {
        status: NewPhotoStatus::Processing { operation: op },
        ..
    }) = f
        .flow
        .view()
        .unwrap()
        .photo_change
        .and_then(|c| c.new_photo)
    else {
        panic!("the new photo is not being processed");
    };
    f.session
        .complete(Completion {
            operation: op,
            outcome: PhotoOutcome::Rejected {
                reason: PhotoRejection::HumanNotStanding,
            }
            .into(),
        })
        .unwrap();
    let view = f.flow.view().unwrap();
    let ScreenView::PhotoRejected { photo, reason } = view.screen else {
        panic!("not the rejected photo: {:?}", view.screen);
    };
    assert_eq!(photo.media, id::<MediaId>("bad"));
    assert_eq!(reason, PhotoRejection::HumanNotStanding);
    // The rejected screen holds the photo; the change has no new one.
    assert_eq!(view.photo_change.unwrap().new_photo, None);
    drain(&f.driver);
    f.flow.dispatch(NavigationAction::Back.into()).unwrap();
    // Leaving the rejected screen releases its photo.
    assert!(drain(&f.driver).contains(&Effect::DeviceEffect {
        effect: MediaEffect::Release { media: id("bad") }.into(),
    }));
    let view = f.flow.view().unwrap();
    assert!(matches!(view.screen, ScreenView::TryOn { .. }));
    assert_eq!(view.photo_change, None);
    assert_eq!(displayed_try_on(view).unwrap().id, id::<TryOnId>("M"));
}

#[test]
fn the_draft_can_change_while_only_one_foreground_request_runs() {
    let f = Fixture::ready();
    f.flow
        .dispatch(PresentationAction::RequestTryOn.into())
        .unwrap();
    let m = render_effect(&f.driver);
    f.flow
        .dispatch(
            SelectionAction::SelectItem {
                axis: "size".into(),
                item: "L".into(),
            }
            .into(),
        )
        .unwrap();
    let busy = f.flow.view().unwrap();
    assert_eq!(busy.selection().variant_id, id("L"));
    assert_eq!(
        busy.presentation().foreground.as_ref().unwrap().variant_id,
        id("M")
    );
    assert!(
        f.flow
            .dispatch(PresentationAction::RequestTryOn.into())
            .is_err()
    );
    assert!(!renders(&drain(&f.driver)));
    finish_render(&f, m, "M");
    assert_eq!(
        displayed_try_on(f.flow.view().unwrap()).unwrap().id,
        id::<TryOnId>("M")
    );
    f.flow
        .dispatch(PresentationAction::RequestTryOn.into())
        .unwrap();
    finish_render(&f, render_effect(&f.driver), "L");
    assert_eq!(
        displayed_try_on(f.flow.view().unwrap()).unwrap().id,
        id::<TryOnId>("L")
    );
}

#[test]
fn cached_request_changes_focus_without_new_render() {
    let f = Fixture::ready();
    try_on_m(&f);
    drain(&f.driver);
    f.flow
        .dispatch(PresentationAction::RequestTryOn.into())
        .unwrap();
    assert_eq!(
        displayed_try_on(f.flow.view().unwrap()).unwrap().id,
        id::<TryOnId>("M")
    );
    assert!(!renders(&drain(&f.driver)));
}

#[test]
fn stale_renewal_cannot_replace_the_accepted_result_url() {
    let f = Fixture::ready();
    try_on_m(&f);
    let id = id::<TryOnId>("M");
    let original = f.session.try_on_asset(id).unwrap().unwrap();
    for url in [
        "https://example.invalid/fresh",
        "https://example.invalid/late",
    ] {
        f.session
            .command(
                TryOnCommand::ReplaceImage {
                    expected: original.clone(),
                    image_url: url.into(),
                }
                .into(),
            )
            .unwrap();
    }
    let asset = f.session.try_on_asset(id).unwrap().unwrap();
    assert_eq!(asset.image_url, "https://example.invalid/fresh");
    assert_eq!(asset.key, original.key);
    assert_eq!(
        displayed_try_on(f.flow.view().unwrap()).unwrap().image_url,
        asset.image_url
    );
}

#[test]
fn closing_countdown_releases_camera_and_stale_timer_cannot_capture() {
    let f = Fixture::new();
    camera_ready(&f);
    f.flow
        .dispatch(
            CameraAction::StartSelfTimer {
                now: MonotonicMillis(100),
            }
            .into(),
        )
        .unwrap();
    let token = countdown_token(&f);
    drain(&f.driver);
    f.flow.dispatch(PresenceAction::Close.into()).unwrap();
    assert!(drain(&f.driver).iter().any(|e| matches!(
        e,
        Effect::DeviceEffect {
            effect: DeviceEffect::Camera {
                effect: CameraEffect::Release { .. }
            },
            ..
        }
    )));
    f.flow
        .complete_device(
            CameraEvent::TimerElapsed {
                token,
                now: MonotonicMillis(20_000),
            }
            .into(),
        )
        .unwrap();
    assert!(!drain(&f.driver).iter().any(|e| matches!(
        e,
        Effect::DeviceEffect {
            effect: DeviceEffect::Camera {
                effect: CameraEffect::CaptureFrame { .. }
            },
            ..
        }
    )));
}

#[test]
fn countdown_uses_deadline_not_tick_count() {
    let f = Fixture::new();
    camera_ready(&f);
    f.flow
        .dispatch(
            CameraAction::StartSelfTimer {
                now: MonotonicMillis(100),
            }
            .into(),
        )
        .unwrap();
    let token = countdown_token(&f);
    f.flow
        .complete_device(
            CameraEvent::TimerElapsed {
                token,
                now: MonotonicMillis(500),
            }
            .into(),
        )
        .unwrap();
    assert!(matches!(
        f.flow.view().unwrap().camera(),
        CameraState::Countdown { .. }
    ));
    f.flow
        .complete_device(
            CameraEvent::TimerElapsed {
                token,
                now: MonotonicMillis(10_100),
            }
            .into(),
        )
        .unwrap();
    assert!(matches!(
        f.flow.view().unwrap().camera(),
        CameraState::Capturing { .. }
    ));
}

#[test]
fn late_camera_acquisition_after_close_is_released() {
    let f = Fixture::new();
    f.flow
        .dispatch(
            PhotoAction::BeginSource {
                source: PhotoSource::Camera,
            }
            .into(),
        )
        .unwrap();
    let CameraState::Acquiring { token } = *f.flow.view().unwrap().camera() else {
        panic!("no camera acquisition");
    };
    f.flow.dispatch(PresenceAction::Close.into()).unwrap();
    drain(&f.driver);
    f.flow
        .complete_device(
            CameraEvent::Acquired {
                token,
                lease: id("late"),
                preview: None,
                devices: None,
            }
            .into(),
        )
        .unwrap();
    assert!(drain(&f.driver).iter().any(|e| matches!(
        e,
        Effect::DeviceEffect {
            effect: DeviceEffect::Camera {
                effect: CameraEffect::Release { lease },
            },
            ..
        } if *lease == id("late")
    )));
}

#[test]
fn stale_picker_media_is_released() {
    let f = Fixture::new();
    f.flow
        .dispatch(
            PhotoAction::BeginSource {
                source: PhotoSource::Library,
            }
            .into(),
        )
        .unwrap();
    let token = picker_token(&f.flow.view().unwrap());
    f.flow.dispatch(PresenceAction::Close.into()).unwrap();
    drain(&f.driver);
    f.flow
        .complete_device(
            PickerEvent::Selected {
                token,
                media: id("late"),
            }
            .into(),
        )
        .unwrap();
    let effects = drain(&f.driver);
    assert!(!effects.iter().any(|e| matches!(
        e,
        Effect::DomainEffect {
            effect: DomainEffect::Start {
                job: Job::Photo { .. },
                ..
            },
        }
    )));
    assert!(effects.iter().any(|e| matches!(
        e,
        Effect::DeviceEffect {
            effect: DeviceEffect::Media {
                effect: MediaEffect::Release { .. }
            },
        }
    )));
}

#[test]
fn library_picker_releases_the_camera_and_reacquires_after_cancellation() {
    let f = Fixture::new();
    camera_ready(&f);
    f.flow
        .dispatch(
            CameraAction::StartSelfTimer {
                now: MonotonicMillis(0),
            }
            .into(),
        )
        .unwrap();
    f.flow
        .dispatch(
            PhotoAction::BeginSource {
                source: PhotoSource::Library,
            }
            .into(),
        )
        .unwrap();
    let effects = drain(&f.driver);
    assert!(effects.iter().any(|effect| matches!(
        effect,
        Effect::DeviceEffect {
            effect: DeviceEffect::Camera {
                effect: CameraEffect::Release { .. }
            }
        }
    )));
    let token = picker_token(&f.flow.view().unwrap());
    f.flow
        .complete_device(PickerEvent::Cancelled { token }.into())
        .unwrap();
    let view = f.flow.view().unwrap();
    assert!(matches!(view.camera(), CameraState::Acquiring { .. }));
}

#[test]
fn back_moves_from_result_to_selection_then_height_and_the_photo_guide() {
    let f = Fixture::ready();
    try_on_m(&f);
    let back = || f.flow.dispatch(NavigationAction::Back.into()).unwrap().view;
    let selection = back();
    assert_eq!(selection.presentation().mode, PresentationMode::Selection);
    assert_eq!(displayed_try_on(selection).unwrap().id, id("M"));
    assert!(matches!(back().screen, ScreenView::Height { .. }));
    let intro = back();
    assert!(matches!(
        intro.screen,
        ScreenView::Introduction {
            consent_given: true
        }
    ));
    assert!(intro.presence.open);
}

#[test]
fn back_from_generation_leaves_the_request_in_history() {
    let f = Fixture::ready();
    f.flow
        .dispatch(PresentationAction::RequestTryOn.into())
        .unwrap();
    let operation = render_effect(&f.driver);

    let view = f.flow.dispatch(NavigationAction::Back.into()).unwrap().view;
    assert_eq!(view.presentation().mode, PresentationMode::Selection);
    assert!(view.presentation().foreground.is_none());
    finish_render(&f, operation, "late");
    let view = f.flow.view().unwrap();
    assert!(displayed_try_on(view).is_none());
    assert!(f.flow.view().unwrap().domain.try_on(id("late")).is_some());
}

#[test]
fn back_from_height_after_a_camera_photo_opens_the_retake_chooser() {
    let f = Fixture::new();
    let operation = f
        .session
        .command(
            PhotoCommand::Process {
                photo: Photo {
                    media: id("capture"),
                    source: PhotoSource::Camera,
                },
            }
            .into(),
        )
        .unwrap()
        .operation
        .unwrap();
    f.session
        .complete(Completion {
            operation,
            outcome: PhotoOutcome::Accepted {
                body_id: id("body"),
                estimated_height: HeightCm(170.0),
            }
            .into(),
        })
        .unwrap();

    let view = f.flow.dispatch(NavigationAction::Back.into()).unwrap().view;
    assert!(matches!(view.screen, ScreenView::Height { .. }));
    assert_eq!(view.modal, Some(Modal::ChoosePhotoSource));
}

#[test]
fn cart_targets_the_available_displayed_result() {
    let f = Fixture::ready();
    try_on_m(&f);
    assert!(matches!(
        f.flow.dispatch(
            SelectionAction::RequestAddToCart {
                variant_id: id("L")
            }
            .into()
        ),
        Err(TryOnError::Rejected {
            reason: Rejection::CartVariantUnavailable
        })
    ));
    f.flow
        .dispatch(
            SelectionAction::RequestAddToCart {
                variant_id: id("M"),
            }
            .into(),
        )
        .unwrap();
    assert!(drain(&f.driver).iter().any(|e| matches!(
        e,
        Effect::FlowEvent {
            event:
                FlowEvent::Selection {
                    event:
                        SelectionEvent::AddToCartRequested { request },
                },
            ..
        } if request.variant_id == id("M") && request.foreign_ids == foreign(&[("size", "M")])
    )));
    assert!(f.flow.view().unwrap().presence.open);
}

#[test]
fn a_sold_out_item_does_not_change_the_draft() {
    let f = Fixture::ready();
    let original = f.flow.view().unwrap().selection().variant_id;
    f.flow
        .dispatch(
            SelectionAction::SetUnavailableVariants {
                variant_ids: vec![id("L")],
                installation: f
                    .flow
                    .view()
                    .unwrap()
                    .product_installation
                    .map(|value| value.token),
            }
            .into(),
        )
        .unwrap();
    let view = f
        .flow
        .dispatch(
            SelectionAction::SelectItem {
                axis: "size".into(),
                item: "L".into(),
            }
            .into(),
        )
        .unwrap()
        .view;
    assert_eq!(view.selection().variant_id, original);
    assert!(
        matches!(view.issue, Some(Issue::StockUnavailable { variant_id, .. }) if variant_id == id("L"))
    );
    f.flow
        .dispatch(
            SelectionAction::SetUnavailableVariants {
                variant_ids: vec![],
                installation: f
                    .flow
                    .view()
                    .unwrap()
                    .product_installation
                    .map(|value| value.token),
            }
            .into(),
        )
        .unwrap();
    assert_eq!(f.flow.view().unwrap().issue, None);
}

#[test]
fn a_cart_completion_cannot_close_a_reopened_dialog() {
    let f = Fixture::ready();
    try_on_m(&f);
    let action = SelectionAction::RequestAddToCart {
        variant_id: id("M"),
    };
    let view = f.flow.dispatch(action.clone().into()).unwrap().view;
    assert!(view.presentation().cart_pending);
    let request = drain(&f.driver)
        .into_iter()
        .find_map(|effect| match effect {
            Effect::DeviceEffect {
                effect: DeviceEffect::Cart { request },
            } => Some(request),
            _ => None,
        })
        .unwrap();
    f.flow.dispatch(action.into()).unwrap();
    assert!(drain(&f.driver).is_empty());

    f.flow.dispatch(PresenceAction::Close.into()).unwrap();
    f.flow.dispatch(PresenceAction::Open.into()).unwrap();
    f.flow
        .complete_device(DeviceEvent::Cart {
            event: CartEvent {
                token: request.token,
                added: true,
            },
        })
        .unwrap();
    let view = f.flow.view().unwrap();
    assert!(view.presence.open);
    assert!(!view.presentation().cart_pending);
}

#[test]
fn a_decoded_image_is_only_accepted_for_its_current_display() {
    let f = Fixture::ready();
    try_on_m(&f);
    let journey = f.flow.view().unwrap().journey;
    let try_on_id = journey.shown_result.unwrap();
    let token = journey.display_token.unwrap();
    f.flow.dispatch(PresenceAction::Close.into()).unwrap();
    f.flow.dispatch(PresenceAction::Open.into()).unwrap();
    let current = f.flow.view().unwrap().journey.display_token.unwrap();
    assert_ne!(current, token);
    f.flow
        .dispatch(PresentationAction::ImageReady { try_on_id, token }.into())
        .unwrap();
    assert!(!f.flow.view().unwrap().journey.presented);
    f.flow
        .dispatch(
            PresentationAction::ImageReady {
                try_on_id,
                token: current,
            }
            .into(),
        )
        .unwrap();
    assert!(f.flow.view().unwrap().journey.presented);
}

#[test]
fn close_does_not_cancel_an_explicit_waiting_render() {
    let f = Fixture::ready();
    let set_height = pending_set_height(&f);
    f.flow
        .dispatch(PresentationAction::RequestTryOn.into())
        .unwrap();
    f.flow.dispatch(PresenceAction::Close.into()).unwrap();
    f.session
        .complete(Completion {
            operation: set_height,
            outcome: BodyOutcome::HeightSet.into(),
        })
        .unwrap();
    assert!(renders(&drain(&f.driver)));
}

#[test]
fn set_height_failure_does_not_destroy_an_open_replacement_picker() {
    let f = Fixture::ready();
    let set_height = pending_set_height(&f);
    assert!(matches!(
        f.flow.view().unwrap().screen,
        ScreenView::TryOn { .. }
    ));
    replace_with_library(&f);
    let token = picker_token(&f.flow.view().unwrap());
    f.session
        .complete(Completion {
            operation: set_height,
            outcome: Outcome::Failed {
                error: BackendError::Unusable,
            },
        })
        .unwrap();
    assert_eq!(picker_token(&f.flow.view().unwrap()), token);
    f.flow
        .complete_device(PickerEvent::Cancelled { token }.into())
        .unwrap();
    let view = f.flow.view().unwrap();
    assert!(matches!(
        view.screen,
        ScreenView::Height {
            draft: Some(HeightCm(180.0))
        }
    ));
    assert!(view.height_needs_change);
    assert!(view.issue.is_some());
}

#[test]
fn the_height_screen_starts_from_the_height_last_confirmed() {
    let f = Fixture::ready();
    let draft = |f: &Fixture| match f.flow.view().unwrap().screen {
        ScreenView::Height { draft } => draft,
        other => panic!("not the height screen: {other:?}"),
    };
    // Back from selecting: the acknowledged height.
    f.flow.dispatch(NavigationAction::Back.into()).unwrap();
    assert_eq!(draft(&f), Some(HeightCm(175.0)));
    f.flow
        .dispatch(
            HeightAction::Edit {
                height: HeightCm(182.0),
            }
            .into(),
        )
        .unwrap();
    f.flow.dispatch(HeightAction::Confirm.into()).unwrap();
    assert!(matches!(
        f.flow.view().unwrap().screen,
        ScreenView::TryOn { .. }
    ));
    let operation = f
        .session
        .snapshot()
        .unwrap()
        .body
        .height()
        .and_then(HeightStatus::outstanding)
        .unwrap();
    f.session
        .complete(Completion {
            operation,
            outcome: Outcome::Failed {
                error: BackendError::Unavailable,
            },
        })
        .unwrap();
    // The write failed: back on the height screen, with the height tried.
    assert_eq!(draft(&f), Some(HeightCm(182.0)));
}

/// A replacement picked on the try-on screen, being processed.
fn replacing(f: &Fixture, media: &str) -> OperationId {
    replace_with_library(f);
    let token = picker_token(&f.flow.view().unwrap());
    f.flow
        .complete_device(
            PickerEvent::Selected {
                token,
                media: id(media),
            }
            .into(),
        )
        .unwrap();
    match f
        .flow
        .view()
        .unwrap()
        .photo_change
        .and_then(|c| c.new_photo)
    {
        Some(NewPhoto {
            status: NewPhotoStatus::Processing { operation },
            ..
        }) => operation,
        other => panic!("the new photo is not being processed: {other:?}"),
    }
}

#[test]
fn a_resume_in_the_foreground_keeps_the_live_camera() {
    let f = Fixture::new();
    camera_ready(&f);
    drain(&f.driver);
    f.flow.dispatch(PresenceAction::Resume.into()).unwrap();
    assert!(drain(&f.driver).is_empty());
    assert!(matches!(
        f.flow.view().unwrap().camera(),
        CameraState::Live { .. }
    ));
}

#[test]
fn back_from_the_camera_returns_to_where_the_change_started() {
    let f = Fixture::ready();
    camera_ready(&f);
    drain(&f.driver);
    f.flow.dispatch(NavigationAction::Back.into()).unwrap();
    let view = f.flow.view().unwrap();
    assert!(matches!(view.screen, ScreenView::TryOn { .. }));
    assert_eq!(view.photo_change, None);
    assert!(
        drain(&f.driver).contains(&Effect::DeviceEffect {
            effect: CameraEffect::Release {
                lease: id("camera-lease"),
            }
            .into(),
        })
    );
}

#[test]
fn the_photo_source_chooser_can_cancel_back_to_height() {
    let f = Fixture::ready();
    f.flow.dispatch(NavigationAction::Back.into()).unwrap();
    f.flow.dispatch(PhotoAction::Replace.into()).unwrap();
    let view = f.flow.view().unwrap();
    assert!(matches!(view.screen, ScreenView::Height { .. }));
    assert_eq!(view.modal, Some(Modal::ChoosePhotoSource));
    f.flow.dispatch(NavigationAction::Back.into()).unwrap();
    let view = f.flow.view().unwrap();
    assert!(matches!(
        view.screen,
        ScreenView::Height {
            draft: Some(HeightCm(175.0))
        }
    ));
    assert_eq!(view.modal, None);
    assert_eq!(view.photo_change, None);
}

#[test]
fn back_from_a_rejected_photo_returns_to_where_the_change_started() {
    let f = Fixture::ready();
    let operation = replacing(&f, "bad");
    f.session
        .complete(Completion {
            operation,
            outcome: PhotoOutcome::Rejected {
                reason: PhotoRejection::HumanNotStanding,
            }
            .into(),
        })
        .unwrap();
    drain(&f.driver);
    f.flow.dispatch(NavigationAction::Back.into()).unwrap();
    assert!(drain(&f.driver).contains(&Effect::DeviceEffect {
        effect: MediaEffect::Release { media: id("bad") }.into(),
    }));
    let view = f.flow.view().unwrap();
    assert!(matches!(view.screen, ScreenView::TryOn { .. }));
    assert_eq!(view.photo_change, None);
    assert_eq!(view.issue, None);
}

#[test]
fn an_uncertain_photo_upload_is_an_issue() {
    let f = Fixture::ready();
    let operation = replacing(&f, "new");
    f.session
        .complete(Completion {
            operation,
            outcome: Outcome::Unknown,
        })
        .unwrap();
    assert_eq!(
        f.flow.view().unwrap().issue,
        Some(Issue::OperationUncertain { operation })
    );
    drain(&f.driver);
    f.flow.dispatch(NavigationAction::Back.into()).unwrap();
    let view = f.flow.view().unwrap();
    assert!(view.photo_change.is_none());
    assert!(!view.domain.uncertain_operations.contains(&operation));
    assert!(drain(&f.driver).contains(&Effect::DomainEffect {
        effect: MediaEffect::Release { media: id("new") }.into(),
    }));
}

#[test]
fn the_try_on_screens_controls_work_only_there() {
    let f = Fixture::ready();
    try_on_m(&f);
    f.flow.dispatch(NavigationAction::Back.into()).unwrap();
    f.flow.dispatch(NavigationAction::Back.into()).unwrap();
    assert!(matches!(
        f.flow.view().unwrap().screen,
        ScreenView::Height { .. }
    ));
    let refused = |action: FlowAction| f.flow.dispatch(action).unwrap_err();
    let unavailable = TryOnError::Rejected {
        reason: Rejection::TryOnUnavailable,
    };
    assert_eq!(
        refused(PresentationAction::ShowTryOn { try_on_id: id("M") }.into()),
        unavailable
    );
    assert_eq!(
        refused(
            SelectionAction::RequestAddToCart {
                variant_id: id("M")
            }
            .into()
        ),
        TryOnError::Rejected {
            reason: Rejection::SelectionUnavailable
        }
    );
}

#[test]
fn a_failed_picker_says_why() {
    let f = Fixture::ready();
    replace_with_library(&f);
    let token = picker_token(&f.flow.view().unwrap());
    let view = f
        .flow
        .complete_device(
            PickerEvent::Failed {
                token,
                error: DeviceError::PermissionDenied,
            }
            .into(),
        )
        .unwrap()
        .view;
    assert_eq!(view.modal, None);
    assert_eq!(
        view.issue,
        Some(Issue::PickerFailed {
            error: DeviceError::PermissionDenied
        })
    );
}

#[test]
fn back_from_the_introduction_leaves_a_change_for_where_it_started() {
    let f = Fixture::ready();
    f.flow.dispatch(NavigationAction::Back.into()).unwrap();
    f.flow.dispatch(PhotoAction::ShowGuide.into()).unwrap();
    assert!(matches!(
        f.flow.view().unwrap().screen,
        ScreenView::Introduction { .. }
    ));
    f.flow.dispatch(NavigationAction::Back.into()).unwrap();
    let view = f.flow.view().unwrap();
    assert!(matches!(view.screen, ScreenView::Height { .. }));
    assert_eq!(view.photo_change, None);
}

#[test]
fn an_uncertain_set_height_is_an_issue_until_it_settles() {
    let f = Fixture::ready();
    let operation = pending_set_height(&f);
    f.session
        .complete(Completion {
            operation,
            outcome: Outcome::Unknown,
        })
        .unwrap();
    assert_eq!(
        f.flow.view().unwrap().issue,
        Some(Issue::OperationUncertain { operation })
    );
    f.session
        .complete(Completion {
            operation,
            outcome: BodyOutcome::HeightSet.into(),
        })
        .unwrap();
    assert_eq!(f.flow.view().unwrap().issue, None);
}

#[test]
fn a_set_height_settling_keeps_an_issue_it_did_not_cause() {
    let f = Fixture::ready();
    let operation = pending_set_height(&f);
    replace_with_library(&f);
    let token = picker_token(&f.flow.view().unwrap());
    f.flow
        .complete_device(
            PickerEvent::Failed {
                token,
                error: DeviceError::PermissionDenied,
            }
            .into(),
        )
        .unwrap();
    f.session
        .complete(Completion {
            operation,
            outcome: BodyOutcome::HeightSet.into(),
        })
        .unwrap();
    assert_eq!(
        f.flow.view().unwrap().issue,
        Some(Issue::PickerFailed {
            error: DeviceError::PermissionDenied
        })
    );
}

#[test]
fn retrying_a_failed_photo_clears_its_failure() {
    let f = Fixture::ready();
    let operation = replacing(&f, "new");
    f.session
        .complete(Completion {
            operation,
            outcome: Outcome::Failed {
                error: BackendError::Unavailable,
            },
        })
        .unwrap();
    assert_eq!(
        f.flow.view().unwrap().issue,
        Some(Issue::PhotoFailed {
            error: BackendError::Unavailable
        })
    );
    let view = f.flow.dispatch(PhotoAction::Retry.into()).unwrap().view;
    assert_eq!(view.issue, None);
    assert!(matches!(
        view.photo_change.and_then(|c| c.new_photo),
        Some(NewPhoto {
            status: NewPhotoStatus::Processing { .. },
            ..
        })
    ));
}

#[test]
fn camera_retry_follows_a_failure_and_switch_turns_a_live_camera() {
    let f = Fixture::new();
    camera_ready(&f);
    let rejected = |reason| TryOnError::Rejected { reason };
    assert_eq!(
        f.flow.dispatch(CameraAction::Retry.into()).unwrap_err(),
        rejected(Rejection::NoCameraFailure)
    );
    let view = f.flow.dispatch(CameraAction::Switch.into()).unwrap().view;
    let CameraState::Acquiring { token } = *view.camera() else {
        panic!("not switching: {:?}", view.camera());
    };
    assert_eq!(
        f.flow.dispatch(CameraAction::Switch.into()).unwrap_err(),
        rejected(Rejection::CameraNotLive)
    );
    f.flow
        .complete_device(
            CameraEvent::AcquireFailed {
                token,
                error: DeviceError::Unavailable,
            }
            .into(),
        )
        .unwrap();
    let view = f.flow.dispatch(CameraAction::Retry.into()).unwrap().view;
    assert!(matches!(view.camera(), CameraState::Acquiring { .. }));
}

#[test]
fn a_stale_camera_preview_cannot_start_the_timer() {
    let f = Fixture::new();
    camera_ready(&f);
    let lease = id("camera-lease");
    let report = |lease, preview| {
        f.flow
            .complete_device(CameraEvent::Preview { lease, preview }.into())
            .unwrap()
    };
    report(lease, CameraPreview::Waiting);
    report(id("another-camera"), CameraPreview::Ready);
    let start = || {
        f.flow.dispatch(
            CameraAction::StartSelfTimer {
                now: MonotonicMillis(100),
            }
            .into(),
        )
    };
    assert_eq!(
        start().unwrap_err(),
        TryOnError::Rejected {
            reason: Rejection::CameraNotLive
        }
    );
    report(lease, CameraPreview::Ready);
    assert!(matches!(
        start().unwrap().view.camera(),
        CameraState::Countdown { .. }
    ));
    let token = countdown_token(&f);
    report(lease, CameraPreview::Waiting);
    let view = f
        .flow
        .complete_device(
            CameraEvent::TimerElapsed {
                token,
                now: MonotonicMillis(20_000),
            }
            .into(),
        )
        .unwrap()
        .view;
    assert_eq!(
        *view.camera(),
        CameraState::Live {
            lease,
            preview: CameraPreview::Waiting
        }
    );
}

#[test]
fn only_the_latest_installation_can_publish_the_same_product() {
    let f = Fixture::ready();
    let host_product = flow_config().host_product;
    let request = id("wanted-install");
    let begin = || {
        f.flow
            .dispatch(
                SelectionAction::BeginProductInstallation {
                    token: request,
                    product_id: host_product.product.id,
                }
                .into(),
            )
            .unwrap()
            .view
            .product_installation
            .unwrap()
            .token
    };
    let first = begin();
    let second = begin();
    assert_ne!(first, second);
    let finish = |token, unavailable_variants| {
        f.flow
            .dispatch(
                SelectionAction::FinishProductInstallation {
                    token,
                    host_product: Some(host_product.clone()),
                    unavailable_variants,
                }
                .into(),
            )
            .unwrap()
            .view
    };
    let stale = finish(first, vec![id("M")]);
    assert_eq!(
        stale.product_installation.unwrap().status,
        ProductInstallationStatus::Pending
    );
    assert!(stale.domain.unavailable_variants.is_empty());
    let accepted = finish(second, vec![id("L")]);
    assert_eq!(
        accepted.product_installation.unwrap().status,
        ProductInstallationStatus::Ready
    );
    assert_eq!(accepted.product_installation.unwrap().token, second);
    assert_eq!(accepted.domain.unavailable_variants, vec![id("L")]);
}

#[test]
fn a_new_image_version_invalidates_actions_until_it_decodes() {
    let f = Fixture::ready();
    let render = |action| {
        f.flow
            .dispatch(FlowAction::RenderMedia { action })
            .unwrap()
            .view
    };
    render(RenderMediaAction::SetRenderer { enabled: true });
    try_on_m(&f);
    let slot = f.flow.view().unwrap().render_media.unwrap().result.unwrap();
    let observe = |version| {
        render(RenderMediaAction::ImageObserved {
            target: slot.target,
            token: slot.token,
            version,
        })
    };
    let decode = |version| {
        render(RenderMediaAction::ImageDecoded {
            target: slot.target,
            token: slot.token,
            version,
            ready: true,
        })
    };
    observe(1);
    assert!(decode(1).render_media.unwrap().cart.available);
    let changed = observe(2);
    assert!(changed.journey.presented);
    assert!(!changed.render_media.unwrap().download.available);
    assert!(!decode(1).render_media.unwrap().cart.available);
    assert!(decode(2).render_media.unwrap().download.available);
    render(RenderMediaAction::SetRenderer { enabled: false });
    let reattached = render(RenderMediaAction::SetRenderer { enabled: true });
    assert_ne!(reattached.journey.display_token, Some(slot.token));
    assert!(reattached.journey.presented);
    assert!(!decode(2).render_media.unwrap().download.available);
}

#[test]
fn a_failed_render_can_open_the_picker_once_and_the_shopper_can_close_it() {
    let f = Fixture::ready();
    try_on_m(&f);
    f.flow
        .dispatch(
            SelectionAction::SelectItem {
                axis: "size".into(),
                item: "L".into(),
            }
            .into(),
        )
        .unwrap();
    f.flow
        .dispatch(PresentationAction::RequestTryOn.into())
        .unwrap();
    f.session
        .complete(Completion {
            operation: render_effect(&f.driver),
            outcome: Outcome::Failed {
                error: BackendError::Unavailable,
            },
        })
        .unwrap();
    let failed = f.flow.view().unwrap();
    assert_eq!(failed.presentation().mode, PresentationMode::EditingVariant);
    let closed = f
        .flow
        .dispatch(PresentationAction::SetVariantPicker { open: false }.into())
        .unwrap()
        .view;
    assert_eq!(closed.presentation().mode, PresentationMode::Result);
    assert_eq!(closed.issue, failed.issue);
    assert!(
        closed
            .presentation()
            .feedback
            .as_ref()
            .unwrap()
            .failure
            .is_some()
    );
}

#[test]
fn a_replaced_renderer_cannot_suspend_or_detach_the_current_renderer() {
    let f = Fixture::ready();
    let attach = || {
        f.flow
            .dispatch(FlowAction::RenderMedia {
                action: RenderMediaAction::Attach {
                    foreground: true,
                    can_add_to_cart: false,
                },
            })
            .unwrap()
            .view
            .renderer
            .unwrap()
    };
    let first = attach();
    let second = attach();
    assert_ne!(first, second);
    let view = f
        .flow
        .dispatch_from_renderer(first, PresenceAction::Suspend.into(), false)
        .unwrap()
        .view;
    assert!(view.presence.foreground);
    let view = f
        .flow
        .dispatch_from_renderer(
            first,
            FlowAction::RenderMedia {
                action: RenderMediaAction::Detach { renderer: first },
            },
            false,
        )
        .unwrap()
        .view;
    assert_eq!(view.renderer, Some(second));
    assert!(view.presence.foreground);
}

#[test]
fn a_cookie_invalidated_during_restore_cannot_establish_the_session() {
    let session = TryOnSession::new(config()).unwrap();
    let driver = session.claim_effect_driver().unwrap();
    let operation = drain(&driver)
        .into_iter()
        .find_map(|effect| match effect {
            Effect::DomainEffect {
                effect:
                    DomainEffect::Start {
                        operation,
                        job:
                            Job::Session {
                                job: SessionJob::Restore,
                            },
                    },
            } => Some(operation),
            _ => None,
        })
        .unwrap();
    session
        .command(
            SessionCommand::CookieInvalidated {
                generation: "old".into(),
            }
            .into(),
        )
        .unwrap();
    session
        .complete(Completion {
            operation,
            outcome: SessionOutcome::CookieEstablished {
                generation: "old".into(),
                body: None,
            }
            .into(),
        })
        .unwrap();
    assert_eq!(session.snapshot().unwrap().session, SessionPhase::Absent);
}

#[test]
fn initial_product_stock_and_active_status_are_part_of_the_installation() {
    let f = Fixture::ready();
    let token = id("initial-product");
    let flow = DefaultTryOnFlow::with_installation(
        f.session.clone(),
        flow_config(),
        InitialProductInstallation {
            token,
            active: false,
            unavailable_variants: vec![id("M")],
        },
    )
    .unwrap();
    let initial = flow.view().unwrap();
    assert_eq!(initial.product_installation.unwrap().token, token);
    assert_eq!(initial.domain.unavailable_variants, vec![id("M")]);
    assert_eq!(
        flow.dispatch(PresenceAction::Open.into()).unwrap_err(),
        TryOnError::Rejected {
            reason: Rejection::NoProductShown,
        }
    );
    flow.dispatch(SelectionAction::SetProductActive { active: true }.into())
        .unwrap();
    assert!(
        flow.dispatch(PresenceAction::Open.into())
            .unwrap()
            .view
            .presence
            .open
    );
}

#[test]
fn a_download_uses_an_image_renewed_while_its_first_fetch_was_in_flight() {
    let f = Fixture::ready();
    let render = |action| {
        f.flow
            .dispatch(FlowAction::RenderMedia { action })
            .unwrap()
            .view
    };
    render(RenderMediaAction::SetRenderer { enabled: true });
    try_on_m(&f);
    let image = f.flow.view().unwrap().render_media.unwrap().result.unwrap();
    let ImageTarget::Result { try_on_id } = image.target else {
        panic!("expected a result image");
    };
    let observe = |version| {
        render(RenderMediaAction::ImageObserved {
            target: image.target,
            token: image.token,
            version,
        })
    };
    observe(1);
    render(RenderMediaAction::ImageDecoded {
        target: image.target,
        token: image.token,
        version: 1,
        ready: true,
    });
    render(RenderMediaAction::Download { try_on_id });
    let work = drain(&f.driver)
        .into_iter()
        .find_map(|effect| match effect {
            Effect::DeviceEffect {
                effect:
                    DeviceEffect::RenderMedia {
                        effect: RenderMediaEffect::Download { work, .. },
                    },
            } => Some(work),
            _ => None,
        })
        .unwrap();

    observe(2);
    f.flow
        .complete_device(DeviceEvent::RenderMedia {
            event: RenderMediaEvent {
                work,
                outcome: RenderMediaOutcome::NeedsRenewal,
            },
        })
        .unwrap();
    let effects = drain(&f.driver);
    assert!(
        effects
            .iter()
            .any(|effect| matches!(effect, Effect::DeviceEffect {
        effect: DeviceEffect::RenderMedia { effect: RenderMediaEffect::Download { image, .. } },
    } if image.version == Some(2)))
    );
    assert!(!effects.iter().any(|effect| matches!(
        effect,
        Effect::DeviceEffect {
            effect: DeviceEffect::RenderMedia {
                effect: RenderMediaEffect::RenewForDownload { .. }
            },
        }
    )));
}

fn experience_facts(
    driver: &EffectDriver,
) -> Vec<state_machine::runtime::experience_events::ExperienceFact> {
    let mut facts = Vec::new();
    while let Some(batch) = driver.next_batch().unwrap() {
        facts.extend(batch.experience_events.into_iter().map(|event| event.fact));
        driver.acknowledge(batch.id).unwrap();
    }
    facts
}

#[test]
fn back_during_a_render_detaches_it_and_its_result_still_lands() {
    let f = Fixture::ready();
    f.flow
        .dispatch(PresentationAction::RequestTryOn.into())
        .unwrap();
    let operation = render_effect(&f.driver);
    let view = f.flow.dispatch(NavigationAction::Back.into()).unwrap().view;
    let ScreenView::TryOn { presentation, .. } = &view.screen else {
        panic!(
            "Back during a render stays on the try-on screen: {:?}",
            view.screen
        );
    };
    assert!(presentation.foreground.is_none());
    assert!(experience_facts(&f.driver).iter().any(|fact| matches!(
        fact,
        state_machine::runtime::experience_events::ExperienceFact::TryOnDetached {
            stage: DetachedStage::Rendering,
            ..
        }
    )));
    finish_render(&f, operation, "M");
    let view = f.flow.view().unwrap();
    let ScreenView::TryOn { presentation, .. } = &view.screen else {
        panic!("still on the try-on screen");
    };
    assert_eq!(presentation.displayed, DisplayedImage::SourcePhoto);
    assert!(view.domain.try_on(id("M")).is_some());
}
