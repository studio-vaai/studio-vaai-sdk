"use client";

import { createContext, useContext, type ReactNode } from "react";

import { defaultSurfaceLandmarks, type SurfaceLandmarks } from "./ui/surface-landmarks.js";

const SurfaceLandmarksContext = createContext(defaultSurfaceLandmarks);

export function SurfaceLandmarksProvider({
  value,
  children,
}: {
  value: SurfaceLandmarks;
  children: ReactNode;
}): React.ReactElement {
  return (
    <SurfaceLandmarksContext.Provider value={value}>{children}</SurfaceLandmarksContext.Provider>
  );
}

/** Merged {@link SurfaceLandmarks} from {@link StudioVaaiUiProvider} (defaults when unset). */
export function useSurfaceLandmarks(): SurfaceLandmarks {
  return useContext(SurfaceLandmarksContext);
}
