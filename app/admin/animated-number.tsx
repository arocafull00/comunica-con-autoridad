"use client";

import { useEffect, useState } from "react";

const duration = 900;

export function AnimatedNumber({ value, digits = 0, suffix = "" }: { value: number; digits?: number; suffix?: string }) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const length = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : duration;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = length ? Math.min((now - start) / length, 1) : 1;
      setShown(value * (1 - (1 - progress) ** 3));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return <>{new Intl.NumberFormat("es-ES", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(digits ? shown : Math.round(shown))}{suffix}</>;
}
