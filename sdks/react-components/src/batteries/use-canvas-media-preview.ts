"use client";

import type { RefObject } from "react";

import { useEffect } from "react";

interface UseCanvasMediaPreviewOptions {
  /** Hidden source `<video>` (receives `srcObject` upstream). */
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Visible preview `<canvas>` that mirrors frames from the video. */
  canvasRef: RefObject<HTMLCanvasElement | null>;
  enabled: boolean;
  mirrored?: boolean;
}

/**
 * Draws a live {@link MediaStream} from a hidden `<video>` onto a visible
 * `<canvas>` via `requestAnimationFrame`. Bypasses embedded WebViews (notably
 * Safari / in-app browsers) that inject native playback chrome on `<video>`.
 */
export function useCanvasMediaPreview({
  videoRef,
  canvasRef,
  enabled,
  mirrored = false,
}: UseCanvasMediaPreviewOptions): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video === null || canvas === null) {
      return;
    }

    const container = canvas.parentElement;
    if (container === null) {
      return;
    }

    const ctx = canvas.getContext("2d");
    if (ctx === null) {
      return;
    }

    video.muted = true;
    video.defaultMuted = true;
    video.setAttribute("muted", "");
    video.setAttribute("playsinline", "");

    let isDrawing = false;
    let rafId = 0;

    const resizeCanvas = (): void => {
      const rect = container.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width));
      canvas.height = Math.max(1, Math.round(rect.height));
    };

    const drawCover = (): void => {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const cw = canvas.width;
      const ch = canvas.height;
      if (vw === 0 || vh === 0 || cw === 0 || ch === 0) {
        return;
      }

      const scale = Math.max(cw / vw, ch / vh);
      const dw = vw * scale;
      const dh = vh * scale;
      const dx = (cw - dw) / 2;
      const dy = (ch - dh) / 2;

      ctx.clearRect(0, 0, cw, ch);
      ctx.save();
      if (mirrored) {
        ctx.translate(cw, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, dx, dy, dw, dh);
      ctx.restore();
    };

    const drawFrame = (): void => {
      if (!isDrawing) {
        return;
      }
      drawCover();
      rafId = requestAnimationFrame(drawFrame);
    };

    const startDrawing = (): void => {
      if (isDrawing) {
        return;
      }
      isDrawing = true;
      resizeCanvas();
      drawFrame();
    };

    const tryPlay = async (): Promise<void> => {
      try {
        await video.play();
      } catch {
        // Autoplay blocked — still attempt to draw whatever frames are available.
      }
      startDrawing();
    };

    const onLoaded = (): void => {
      resizeCanvas();
      void tryPlay();
    };

    const onCanPlay = (): void => {
      void tryPlay();
    };

    video.addEventListener("loadeddata", onLoaded);
    video.addEventListener("canplay", onCanPlay);

    const resizeObserver = new ResizeObserver(() => {
      resizeCanvas();
    });
    resizeObserver.observe(container);

    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      void tryPlay();
    }

    return () => {
      isDrawing = false;
      cancelAnimationFrame(rafId);
      video.removeEventListener("loadeddata", onLoaded);
      video.removeEventListener("canplay", onCanPlay);
      resizeObserver.disconnect();
    };
  }, [canvasRef, enabled, mirrored, videoRef]);
}
