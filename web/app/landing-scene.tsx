"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Decorative 3D stage in the landing hero. It passes the pointer position to
 * CSS as --px/--py (-1..1) so the stack of sheets tilts towards it. Without a
 * fine pointer, or with reduced motion, the stage stays at rest.
 */
export function LandingScene({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scene = ref.current;
    if (!scene) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const onMove = (event: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        scene.style.setProperty("--px", ((event.clientX / window.innerWidth) * 2 - 1).toFixed(3));
        scene.style.setProperty("--py", ((event.clientY / window.innerHeight) * 2 - 1).toFixed(3));
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => { window.removeEventListener("pointermove", onMove); cancelAnimationFrame(frame); };
  }, []);
  return <div className="hero-scene" ref={ref}><div className="hero-stage">{children}</div></div>;
}
