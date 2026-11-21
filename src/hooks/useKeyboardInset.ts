"use client";

import { useEffect, useState } from "react";

/**
 * How many pixels of the bottom of the window the on-screen keyboard covers.
 *
 * A bar stuck to the bottom of the page sits UNDER the keyboard on a phone:
 * the keyboard overlays the page instead of shrinking it. The summary and the
 * Save button are exactly what the operator needs to see while typing an
 * amount, so the bar is lifted by this much. Zero on desktop and wherever the
 * visualViewport API is missing.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;
    const update = () => {
      const covered = window.innerHeight - vv.height - vv.offsetTop;
      // Small differences are browser chrome, not a keyboard.
      setInset(covered > 80 ? Math.round(covered) : 0);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return inset;
}
