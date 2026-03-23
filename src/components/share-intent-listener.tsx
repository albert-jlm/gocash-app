"use client";

import { useShareIntent } from "@/hooks/useShareIntent";

export function ShareIntentListener() {
  useShareIntent();
  return null;
}
