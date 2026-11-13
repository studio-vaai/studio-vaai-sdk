import type { LeaseId, MediaId } from "@studio-vaai/core";

import {
  CameraEffect,
  CameraEvent,
  CameraPreview,
  DeviceEffect,
  DeviceError,
  DeviceEvent,
  MediaEffect,
  PickerEffect,
  PickerEvent,
} from "@studio-vaai/core";

import type { SvCameraCapture } from "../../components/camera/sv-camera.js";
import type { TryOnExperienceDevices } from "../api/adapter.js";
import type { TryOnExperienceCamera, TryOnExperiencePhoto } from "../controller.js";

import { convertHeicToJpeg } from "./photo/heic.js";

interface PhotoRecord extends TryOnExperiencePhoto {
  bytes?: Blob;
  flow: boolean;
  domain: boolean;
}

export interface BrowserTryOnDevices extends TryOnExperienceDevices {
  /** Registers an API photo restored with its shopper session. */
  restorePhoto(src: string): MediaId;
}

interface BrowserDeviceOptions {
  capture?(stream: MediaStream): Promise<SvCameraCapture>;
  complete(event: DeviceEvent): void;
}

function deviceError(error: unknown): DeviceError {
  if (error instanceof DOMException) {
    switch (error.name) {
      case "NotAllowedError":
      case "SecurityError": {
        return DeviceError.PermissionDenied;
      }
      case "NotFoundError":
      case "NotReadableError":
      case "OverconstrainedError": {
        return DeviceError.Unavailable;
      }
      case "AbortError": {
        return DeviceError.Interrupted;
      }
      default: {
        break;
      }
    }
  }
  return DeviceError.Failed;
}

function stop(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

/** Owns browser device effects and media leases for one experience. */
export function createBrowserTryOnDevices(options: BrowserDeviceOptions): BrowserTryOnDevices {
  const cameras = new Map<LeaseId, TryOnExperienceCamera>();
  const photos = new Map<MediaId, PhotoRecord>();
  const pending = new Map<string, () => void>();
  const lifetime = new AbortController();

  function register(photo: PhotoRecord): MediaId {
    const id = crypto.randomUUID();
    photos.set(id, photo);
    return id;
  }

  function forget(id: MediaId, photo: PhotoRecord): void {
    if (photo.bytes !== undefined) {
      URL.revokeObjectURL(photo.src);
    }
    photos.delete(id);
  }

  function media(effect: MediaEffect, owner: "flow" | "domain"): void {
    const id = effect.inner.media;
    const photo = photos.get(id);
    if (photo !== undefined) {
      photo[owner] = MediaEffect.Retain.instanceOf(effect);
      if (!photo.flow && !photo.domain) {
        forget(id, photo);
      }
    }
  }

  function releaseCamera(lease: LeaseId): void {
    const camera = cameras.get(lease);
    if (camera) {
      cameras.delete(lease);
      stop(camera.stream);
    }
  }

  async function picker(token: string): Promise<DeviceEvent | undefined> {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*,.heic,.heif";
    input.hidden = true;
    document.body.append(input);
    const { promise, resolve } = Promise.withResolvers<File | undefined>();
    const dismiss = () => {
      resolve(globalThis.undefined);
    };
    const cancel = new AbortController();
    pending.set(token, () => {
      cancel.abort();
      dismiss();
    });
    input.addEventListener(
      "change",
      () => {
        resolve(input.files?.[0]);
      },
      { once: true },
    );
    input.addEventListener("cancel", dismiss, { once: true });

    try {
      // Runs before the first await, while the original click still has activation.
      if (typeof input.showPicker === "function") {
        input.showPicker();
      } else if (navigator.userActivation !== undefined && !navigator.userActivation.isActive) {
        return new DeviceEvent.Picker({
          event: new PickerEvent.Failed({ token, error: DeviceError.PermissionDenied }),
        });
      } else {
        input.click();
      }
      const file = await promise;
      if (cancel.signal.aborted) {
        return undefined;
      }
      if (file === undefined) {
        return new DeviceEvent.Picker({ event: new PickerEvent.Cancelled({ token }) });
      }
      const preview = (await convertHeicToJpeg(file, file.name, cancel.signal)) ?? file;
      cancel.signal.throwIfAborted();
      const id = register({
        src: URL.createObjectURL(preview),
        bytes: file,
        flow: false,
        domain: false,
      });
      return new DeviceEvent.Picker({ event: new PickerEvent.Selected({ token, media: id }) });
    } catch (error) {
      return cancel.signal.aborted
        ? undefined
        : new DeviceEvent.Picker({
            event: new PickerEvent.Failed({ token, error: deviceError(error) }),
          });
    } finally {
      pending.delete(token);
      input.remove();
    }
  }

  async function acquire(
    token: string,
    deviceId: string | undefined,
  ): Promise<DeviceEvent | undefined> {
    const devices = navigator.mediaDevices;
    if (devices === undefined) {
      return new DeviceEvent.Camera({
        event: new CameraEvent.AcquireFailed({ token, error: DeviceError.Unavailable }),
      });
    }
    const cancel = new AbortController();
    let stream: MediaStream | undefined;
    pending.set(token, () => {
      cancel.abort();
      if (stream !== undefined) {
        stop(stream);
      }
    });
    const signal = AbortSignal.any([cancel.signal, lifetime.signal]);
    try {
      const acquireVideo = async (id?: string) =>
        await devices.getUserMedia({
          video:
            id === undefined || id === ""
              ? { facingMode: { ideal: "user" } }
              : { deviceId: { exact: id } },
          audio: false,
        });
      signal.throwIfAborted();
      try {
        stream = await acquireVideo(deviceId);
      } catch (error) {
        if (
          deviceId === undefined ||
          !(error instanceof DOMException) ||
          (error.name !== "NotFoundError" && error.name !== "OverconstrainedError")
        ) {
          throw error;
        }
        signal.throwIfAborted();
        stream = await acquireVideo();
      }
      if (signal.aborted) {
        stop(stream);
        return undefined;
      }
      const camerasFound = await devices.enumerateDevices().catch(() => []);
      if (signal.aborted) {
        return undefined;
      }
      const tracks = stream.getVideoTracks();
      if (!tracks.some((track) => track.readyState === "live")) {
        stop(stream);
        return new DeviceEvent.Camera({
          event: new CameraEvent.AcquireFailed({ token, error: DeviceError.Interrupted }),
        });
      }
      const lease = crypto.randomUUID();
      const selected = tracks[0]?.getSettings().deviceId;
      const available = [
        ...new Set(
          camerasFound.flatMap(({ kind, deviceId: id }) =>
            kind === "videoinput" && id !== "" ? [id] : [],
          ),
        ),
      ];
      cameras.set(lease, { stream });
      for (const track of tracks) {
        track.addEventListener(
          "ended",
          () => {
            if (cameras.has(lease)) {
              releaseCamera(lease);
              options.complete(
                new DeviceEvent.Camera({
                  event: new CameraEvent.Lost({ lease, error: DeviceError.Interrupted }),
                }),
              );
            }
          },
          { once: true },
        );
      }
      return new DeviceEvent.Camera({
        event: new CameraEvent.Acquired({
          token,
          lease,
          preview: CameraPreview.Waiting,
          devices: { ...(selected === undefined ? {} : { selected }), available },
        }),
      });
    } catch (error) {
      if (stream !== undefined && !signal.aborted) {
        stop(stream);
      }
      return signal.aborted
        ? undefined
        : new DeviceEvent.Camera({
            event: new CameraEvent.AcquireFailed({ token, error: deviceError(error) }),
          });
    } finally {
      pending.delete(token);
    }
  }

  async function capture(
    token: string,
    lease: LeaseId,
    captureFrame = options.capture?.bind(options),
  ): Promise<DeviceEvent | undefined> {
    try {
      const camera = cameras.get(lease);
      if (camera === undefined) {
        throw new Error("The camera lease ended.");
      }
      if (captureFrame === undefined) {
        throw new Error("No renderer is available to capture the camera frame.");
      }
      const { blob, crop } = await captureFrame(camera.stream);
      if (lifetime.signal.aborted || cameras.get(lease) !== camera) {
        return undefined;
      }
      const id = register({
        src: URL.createObjectURL(blob),
        bytes: blob,
        crop,
        flow: false,
        domain: false,
      });
      return new DeviceEvent.Camera({ event: new CameraEvent.FrameCaptured({ token, media: id }) });
    } catch (error) {
      return new DeviceEvent.Camera({
        event: new CameraEvent.CaptureFailed({ token, error: deviceError(error) }),
      });
    }
  }

  async function timer(token: string, deadline: bigint): Promise<DeviceEvent | undefined> {
    const { promise, resolve } = Promise.withResolvers<DeviceEvent | undefined>();
    const handle = setTimeout(
      () => {
        pending.delete(token);
        resolve(
          new DeviceEvent.Camera({
            event: new CameraEvent.TimerElapsed({
              token,
              now: BigInt(Math.floor(performance.now())),
            }),
          }),
        );
      },
      Math.max(0, Number(deadline) - performance.now()),
    );
    pending.set(token, () => {
      clearTimeout(handle);
      pending.delete(token);
      resolve(globalThis.undefined);
    });
    return await promise;
  }

  return {
    startDeviceEffect(
      effect,
      captureFrame,
    ): ReturnType<TryOnExperienceDevices["startDeviceEffect"]> {
      if (DeviceEffect.Media.instanceOf(effect)) {
        media(effect.inner.effect, "flow");
      } else if (DeviceEffect.Picker.instanceOf(effect)) {
        const work = effect.inner.effect;
        if (PickerEffect.Open.instanceOf(work)) {
          return picker(work.inner.token);
        }
        pending.get(work.inner.token)?.();
      } else {
        const work = effect.inner.effect;
        if (CameraEffect.Acquire.instanceOf(work)) {
          return acquire(work.inner.token, work.inner.deviceId);
        }
        if (CameraEffect.Release.instanceOf(work)) {
          releaseCamera(work.inner.lease);
        } else if (CameraEffect.CaptureFrame.instanceOf(work)) {
          return capture(work.inner.token, work.inner.lease, captureFrame);
        } else if (CameraEffect.ScheduleTimer.instanceOf(work)) {
          return timer(work.inner.token, work.inner.deadline);
        } else {
          pending.get(work.inner.token)?.();
        }
      }
      return globalThis.undefined;
    },
    getPhoto: (id) => photos.get(id),
    getUploadPhoto: (id) => photos.get(id)?.bytes,
    applyDomainMediaEffect(effect) {
      media(effect, "domain");
    },
    getCamera: (lease) => cameras.get(lease),
    restorePhoto: (src) => register({ src, flow: false, domain: false }),
    dispose() {
      lifetime.abort();
      for (const cancel of pending.values()) {
        cancel();
      }
      for (const lease of cameras.keys()) {
        releaseCamera(lease);
      }
      for (const [id, photo] of photos) {
        forget(id, photo);
      }
    },
  };
}
