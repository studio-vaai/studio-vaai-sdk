//! Current image readiness and recovery. The renderer owns URLs, decoded
//! images and download handles. The flow correlates their reports.

use super::{DefaultController, DeviceEffect, Issue, Plan, PresentationMode, navigation::Screen};
use crate::{DomainSnapshot, InteractionToken, MediaId, Rejection, TryOnId};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum ImageTarget {
    Source { media: MediaId },
    Result { try_on_id: TryOnId },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum ImagePhase {
    Loading,
    Recovering,
    Retrying,
    Ready,
    Failed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct ImageView {
    pub target: ImageTarget,
    pub token: InteractionToken,
    /// The accepted asset. Its URL stays in the renderer.
    pub asset: Option<InteractionToken>,
    /// The rendered image node can stay mounted when the same decoded asset is reused.
    pub load: Option<InteractionToken>,
    /// The current decode attempt for this display.
    pub version: Option<u32>,
    pub phase: ImagePhase,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct RenderMediaView {
    pub source: Option<ImageView>,
    pub result: Option<ImageView>,
    pub download: ResultActionView,
    pub cart: ResultActionView,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct ResultActionView {
    pub available: bool,
    pub pending: bool,
    pub failed: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum RenderMediaAction {
    Attach {
        foreground: bool,
        can_add_to_cart: bool,
    },
    Detach {
        renderer: InteractionToken,
    },
    SetCartAvailable {
        renderer: InteractionToken,
        available: bool,
    },
    SetRenderer {
        enabled: bool,
    },
    ImageObserved {
        target: ImageTarget,
        token: InteractionToken,
        version: u32,
    },
    ImageAssetObserved {
        target: ImageTarget,
        token: InteractionToken,
        asset: InteractionToken,
    },
    SourceAssetObserved {
        media: MediaId,
        asset: InteractionToken,
        expires_at: u64,
        now: u64,
    },
    ImageDecoded {
        target: ImageTarget,
        token: InteractionToken,
        version: u32,
        ready: bool,
    },
    Download {
        try_on_id: TryOnId,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum RenderMediaEffect {
    /// Sample the committed source asset after a change or when the experience opens again.
    ObserveSource {
        media: MediaId,
    },
    /// Renew a restored photo before it needs to load.
    PrepareSource {
        media: MediaId,
        asset: InteractionToken,
    },
    Recover {
        image: ImageView,
        work: InteractionToken,
    },
    RenewForDownload {
        image: ImageView,
        work: InteractionToken,
    },
    Download {
        image: ImageView,
        work: InteractionToken,
    },
    Cancel {
        work: InteractionToken,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum RenderMediaOutcome {
    Succeeded,
    Failed,
    NeedsRenewal,
}

/// Time the host allows an individual recovery or download effect to run.
#[cfg_attr(feature = "uniffi", uniffi::export)]
pub fn render_media_timeout_ms() -> u32 {
    30_000
}

/// A rejected or missing signed URL may be replaced once by the media flow.
#[cfg_attr(feature = "uniffi", uniffi::export)]
pub fn classify_download_failure(status: Option<u16>, can_renew: bool) -> RenderMediaOutcome {
    if can_renew && matches!(status, Some(401 | 403 | 404 | 410)) {
        RenderMediaOutcome::NeedsRenewal
    } else {
        RenderMediaOutcome::Failed
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct RenderMediaEvent {
    pub work: InteractionToken,
    pub outcome: RenderMediaOutcome,
}

#[derive(Clone, Copy, Debug)]
struct ImageSlot {
    view: ImageView,
    recovery: Option<(InteractionToken, Option<u32>)>,
    recovered: bool,
    previous_result: Option<ImageView>,
}

#[derive(Clone, Debug, Default)]
pub(super) struct RenderMedia {
    renderer: Option<Renderer>,
    source: Option<ImageSlot>,
    result: Option<ImageSlot>,
    download: Option<Download>,
    download_failed: bool,
    prepared_source: Option<(MediaId, InteractionToken)>,
}

#[derive(Clone, Copy, Debug)]
enum Renderer {
    Standalone,
    Attached {
        token: InteractionToken,
        can_add_to_cart: bool,
    },
}

#[derive(Clone, Copy, Debug)]
struct Download {
    work: InteractionToken,
    stage: DownloadStage,
}

#[derive(Clone, Copy, Debug)]
enum DownloadStage {
    Fetch { version: Option<u32> },
    Renew { version: Option<u32> },
    Retry,
}

impl ImageSlot {
    fn observed(&mut self, version: u32) {
        if self.view.version.is_some_and(|last| version <= last) {
            return;
        }
        let retrying = matches!(
            self.view.phase,
            ImagePhase::Recovering | ImagePhase::Retrying
        );
        self.view.version = Some(version);
        self.recovered = retrying;
        self.view.phase = if retrying {
            ImagePhase::Retrying
        } else {
            ImagePhase::Loading
        };
    }

    fn cancel_recovery(&mut self, effects: &mut Vec<crate::Effect>) {
        if let Some((work, _)) = self.recovery.take() {
            cancel(work, effects);
            if matches!(
                self.view.phase,
                ImagePhase::Recovering | ImagePhase::Retrying
            ) {
                self.view.phase = ImagePhase::Failed;
            }
        }
    }

    fn replace(slot: &mut Option<Self>, next: Option<ImageView>, effects: &mut Vec<crate::Effect>) {
        if let Some((work, _)) = slot.and_then(|current| current.recovery) {
            cancel(work, effects);
        }
        *slot = next.map(|view| Self {
            view,
            recovery: None,
            recovered: false,
            previous_result: None,
        });
    }
}

fn cancel(work: InteractionToken, effects: &mut Vec<crate::Effect>) {
    effects.push(crate::Effect::DeviceEffect {
        effect: DeviceEffect::RenderMedia {
            effect: RenderMediaEffect::Cancel { work },
        },
    });
}

impl RenderMedia {
    fn image(&mut self, target: ImageTarget, token: InteractionToken) -> Option<&mut ImageSlot> {
        let slot = match target {
            ImageTarget::Source { .. } => &mut self.source,
            ImageTarget::Result { .. } => &mut self.result,
        };
        slot.as_mut()
            .filter(|slot| slot.view.target == target && slot.view.token == token)
    }
}

impl DefaultController {
    pub(super) fn media_renderer_enabled(&self) -> bool {
        self.render_media.renderer.is_some()
    }

    pub(crate) fn renderer_token(&self) -> Option<InteractionToken> {
        match self.render_media.renderer {
            Some(Renderer::Attached { token, .. }) => Some(token),
            _ => None,
        }
    }

    pub(super) fn renderer_can_add_to_cart(&self) -> bool {
        !matches!(
            self.render_media.renderer,
            Some(Renderer::Attached {
                can_add_to_cart: false,
                ..
            })
        )
    }

    fn change_renderer(
        &mut self,
        renderer: Option<Renderer>,
        plan: &mut Plan,
    ) -> Result<(), Rejection> {
        self.render_media.renderer = renderer;
        if let Some((id, _)) = self.journey.display {
            self.journey.display = Some((id, self.token()?));
        }
        let work = [
            self.render_media
                .source
                .take()
                .and_then(|slot| slot.recovery.map(|(work, _)| work)),
            self.render_media
                .result
                .take()
                .and_then(|slot| slot.recovery.map(|(work, _)| work)),
            self.render_media
                .download
                .take()
                .map(|download| download.work),
        ];
        for work in work.into_iter().flatten() {
            plan.effect(DeviceEffect::RenderMedia {
                effect: RenderMediaEffect::Cancel { work },
            });
        }
        self.render_media.download_failed = false;
        Ok(())
    }

    pub(super) fn image_ready_for_cart(&self) -> bool {
        !self.media_renderer_enabled()
            || self
                .render_media
                .result
                .is_some_and(|slot| slot.view.phase == ImagePhase::Ready)
    }

    pub(super) fn render_media_view(&self, snapshot: &DomainSnapshot) -> Option<RenderMediaView> {
        self.media_renderer_enabled().then(|| {
            let result = self.render_media.result.map(|slot| slot.view);
            let visible =
                self.presence.active() && self.journey_view(snapshot).shown_result.is_some();
            let ready = result.is_some_and(|image| image.phase == ImagePhase::Ready);
            RenderMediaView {
                source: self.render_media.source.map(|slot| slot.view),
                result,
                download: ResultActionView {
                    available: visible
                        && ready
                        && self.presentation.mode != PresentationMode::Selection
                        && !self.foreground_rendering(snapshot)
                        && self.render_media.download.is_none(),
                    pending: self.render_media.download.is_some(),
                    failed: self.render_media.download_failed,
                },
                cart: self.cart_view(snapshot),
            }
        })
    }

    pub(super) fn download_issue(&self) -> Option<Issue> {
        let ImageTarget::Result { try_on_id } = self.render_media.result?.view.target else {
            return None;
        };
        self.render_media
            .download_failed
            .then_some(Issue::DownloadFailed { try_on_id })
    }

    pub(super) fn sync_render_media(
        &mut self,
        display: Option<(TryOnId, InteractionToken)>,
        snapshot: &DomainSnapshot,
        effects: &mut Vec<crate::Effect>,
    ) -> Result<(), Rejection> {
        if self
            .render_media
            .prepared_source
            .is_some_and(|(media, _)| snapshot.photo.is_none_or(|photo| photo.media != media))
        {
            self.render_media.prepared_source = None;
        }
        let enabled = self.media_renderer_enabled() && self.presence.open;
        let source = enabled
            .then(|| {
                self.new_photo().map(|photo| photo.photo.media).or_else(|| {
                    match self.navigation.screen {
                        Screen::PhotoRejected { photo, .. } => Some(photo.media),
                        Screen::Height { .. } | Screen::TryOn => {
                            snapshot.photo.map(|photo| photo.media)
                        }
                        _ => None,
                    }
                })
            })
            .flatten()
            .map(|media| ImageTarget::Source { media });
        if self.render_media.source.map(|slot| slot.view.target) != source {
            let next = match source {
                Some(target) => Some(ImageView {
                    target,
                    token: self.token()?,
                    asset: None,
                    load: None,
                    version: None,
                    phase: ImagePhase::Loading,
                }),
                None => None,
            };
            ImageSlot::replace(&mut self.render_media.source, next, effects);
        }
        let result = display.filter(|_| enabled);
        let token_changed =
            self.render_media.result.map(|slot| slot.view.token) != result.map(|(_, token)| token);
        if token_changed {
            let next = result.map(|(try_on_id, token)| ImageView {
                target: ImageTarget::Result { try_on_id },
                token,
                asset: None,
                load: None,
                version: None,
                phase: ImagePhase::Loading,
            });
            let previous = self
                .render_media
                .result
                .map(|slot| slot.view)
                .filter(|image| image.phase == ImagePhase::Ready && image.load.is_some());
            ImageSlot::replace(&mut self.render_media.result, next, effects);
            if let Some(slot) = &mut self.render_media.result {
                slot.previous_result = previous;
            }
        }
        let visible = self.presence.active() && self.journey_view(snapshot).shown_result.is_some();
        if !visible && let Some(slot) = &mut self.render_media.result {
            slot.cancel_recovery(effects);
        }
        if (token_changed || !visible)
            && let Some(Download { work, .. }) = self.render_media.download.take()
        {
            cancel(work, effects);
        }
        if token_changed {
            self.render_media.download_failed = false;
        }
        Ok(())
    }

    pub(super) fn render_media_action(
        &mut self,
        action: RenderMediaAction,
        snapshot: &DomainSnapshot,
        plan: &mut Plan,
    ) -> Result<(), Rejection> {
        match action {
            RenderMediaAction::Attach {
                foreground,
                can_add_to_cart,
            } => {
                if self.renderer_token().is_some() || !foreground {
                    self.presence_action(super::PresenceAction::Suspend, snapshot, plan)?;
                }
                let token = self.token()?;
                self.change_renderer(
                    Some(Renderer::Attached {
                        token,
                        can_add_to_cart,
                    }),
                    plan,
                )?;
                if foreground && !self.presence.foreground {
                    self.presence_action(super::PresenceAction::Resume, snapshot, plan)?;
                }
            }
            RenderMediaAction::Detach { renderer } if self.renderer_token() == Some(renderer) => {
                self.change_renderer(None, plan)?;
                self.presence_action(super::PresenceAction::Suspend, snapshot, plan)?;
            }
            RenderMediaAction::SetCartAvailable {
                renderer,
                available,
            } => {
                if let Some(Renderer::Attached {
                    token,
                    can_add_to_cart,
                }) = &mut self.render_media.renderer
                    && *token == renderer
                {
                    *can_add_to_cart = available;
                }
            }
            RenderMediaAction::SetRenderer { enabled } if self.renderer_token().is_none() => {
                self.change_renderer(enabled.then_some(Renderer::Standalone), plan)?;
            }
            RenderMediaAction::Detach { .. } | RenderMediaAction::SetRenderer { .. } => {}
            RenderMediaAction::ImageObserved {
                target,
                token,
                version,
            } => {
                if matches!(self.render_media.renderer, Some(Renderer::Standalone))
                    && let Some(slot) = self.render_media.image(target, token)
                {
                    slot.observed(version);
                }
            }
            RenderMediaAction::ImageAssetObserved {
                target,
                token,
                asset,
            } => {
                if let Some(slot) = self.render_media.image(target, token)
                    && slot.view.asset != Some(asset)
                {
                    slot.view.asset = Some(asset);
                    let version = slot
                        .view
                        .version
                        .unwrap_or_default()
                        .checked_add(1)
                        .ok_or(Rejection::Exhausted)?;
                    let reuse = slot
                        .previous_result
                        .take()
                        .filter(|previous| previous.asset == Some(asset));
                    slot.observed(version);
                    if let Some(previous) = reuse {
                        slot.view.load = previous.load;
                        slot.view.phase = ImagePhase::Ready;
                    } else {
                        slot.view.load = Some(self.tokens.next()?);
                    }
                }
            }
            RenderMediaAction::SourceAssetObserved {
                media,
                asset,
                expires_at,
                now,
            } => {
                const RENEWAL_MARGIN_MS: u64 = 5_000;
                if snapshot.photo.is_some_and(|photo| photo.media == media)
                    && expires_at <= now.saturating_add(RENEWAL_MARGIN_MS)
                    && self.render_media.prepared_source != Some((media, asset))
                {
                    self.render_media.prepared_source = Some((media, asset));
                    plan.effect(DeviceEffect::RenderMedia {
                        effect: RenderMediaEffect::PrepareSource { media, asset },
                    });
                }
            }
            RenderMediaAction::ImageDecoded {
                target,
                token,
                version,
                ready,
            } => {
                let Some(slot) = self
                    .render_media
                    .image(target, token)
                    .filter(|slot| slot.view.version == Some(version))
                else {
                    return Ok(());
                };
                if ready {
                    slot.view.phase = ImagePhase::Ready;
                } else if slot.view.phase == ImagePhase::Recovering {
                    // The old node can report failure again while its URL is being renewed.
                } else if slot.recovered {
                    slot.view.phase = ImagePhase::Failed;
                } else {
                    slot.view.phase = ImagePhase::Recovering;
                    slot.recovered = true;
                    let image = slot.view;
                    let work = self.tokens.next()?;
                    slot.recovery = Some((work, image.version));
                    plan.effect(DeviceEffect::RenderMedia {
                        effect: RenderMediaEffect::Recover { image, work },
                    });
                }
            }
            RenderMediaAction::Download { try_on_id } => {
                let Some(view) = self
                    .render_media_view(snapshot)
                    .filter(|view| view.download.available)
                else {
                    return Ok(());
                };
                let Some(image) = view
                    .result
                    .filter(|image| image.target == (ImageTarget::Result { try_on_id }))
                else {
                    return Ok(());
                };
                let work = self.token()?;
                self.render_media.download = Some(Download {
                    work,
                    stage: DownloadStage::Fetch {
                        version: image.version,
                    },
                });
                self.render_media.download_failed = false;
                plan.effect(DeviceEffect::RenderMedia {
                    effect: RenderMediaEffect::Download { image, work },
                });
            }
        }
        Ok(())
    }

    fn download_completed(
        &mut self,
        download: Download,
        outcome: RenderMediaOutcome,
        plan: &mut Plan,
    ) -> Result<(), Rejection> {
        let Some(image) = self.render_media.result.map(|slot| slot.view) else {
            return Ok(());
        };
        match (download.stage, outcome) {
            (DownloadStage::Fetch { version }, RenderMediaOutcome::NeedsRenewal)
            | (DownloadStage::Renew { version }, RenderMediaOutcome::Succeeded)
                if image.version != version =>
            {
                let work = self.token()?;
                self.render_media.download = Some(Download {
                    work,
                    stage: DownloadStage::Retry,
                });
                plan.effect(DeviceEffect::RenderMedia {
                    effect: RenderMediaEffect::Download { image, work },
                });
            }
            (DownloadStage::Fetch { version }, RenderMediaOutcome::NeedsRenewal) => {
                let work = self.token()?;
                self.render_media.download = Some(Download {
                    work,
                    stage: DownloadStage::Renew { version },
                });
                plan.effect(DeviceEffect::RenderMedia {
                    effect: RenderMediaEffect::RenewForDownload { image, work },
                });
            }
            (DownloadStage::Fetch { .. } | DownloadStage::Retry, RenderMediaOutcome::Succeeded) => {
            }
            _ => {
                self.render_media.download_failed = true;
            }
        }
        Ok(())
    }

    pub(super) fn render_media_event(
        &mut self,
        event: RenderMediaEvent,
        plan: &mut Plan,
    ) -> Result<(), Rejection> {
        if self
            .render_media
            .download
            .is_some_and(|download| download.work == event.work)
            && let Some(download) = self.render_media.download.take()
        {
            return self.download_completed(download, event.outcome, plan);
        }
        for slot in [&mut self.render_media.source, &mut self.render_media.result]
            .into_iter()
            .flatten()
        {
            if let Some((work, version)) = slot.recovery
                && work == event.work
            {
                slot.recovery = None;
                if slot.view.phase == ImagePhase::Recovering {
                    if event.outcome == RenderMediaOutcome::Succeeded {
                        if slot.view.asset.is_some() && slot.view.version == version {
                            slot.view.load = Some(self.tokens.next()?);
                            slot.observed(
                                version
                                    .unwrap_or_default()
                                    .checked_add(1)
                                    .ok_or(Rejection::Exhausted)?,
                            );
                        }
                        slot.view.phase = ImagePhase::Retrying;
                    } else {
                        slot.view.phase = ImagePhase::Failed;
                    }
                }
            }
        }
        Ok(())
    }
}
