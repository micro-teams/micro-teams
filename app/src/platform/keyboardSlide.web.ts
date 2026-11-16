/*
 * The web half of keyboardSlide.ts. A resize that shrinks or grows the page while a text field has
 * focus moves the targets by the difference at once, without a transition, so they appear not to
 * have moved; on the next frame the transform is released with a transition, and they glide to
 * where the new layout put them. A desktop window dragged to another size has no focused field
 * involved and is left alone.
 */
import { useEffect, useRef } from "react";

const MS = 220;

function typing(): boolean {
  const el = document.activeElement;
  return !!el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT");
}

export function useKeyboardSlide(targets: () => unknown[]): void {
  const latest = useRef(targets);
  useEffect(() => {
    latest.current = targets;
  });
  useEffect(() => {
    let height = window.innerHeight;
    const onResize = () => {
      const delta = height - window.innerHeight;
      height = window.innerHeight;
      if (!delta || !typing()) return;
      const els = latest.current().filter((e): e is HTMLElement => e instanceof HTMLElement);
      for (const el of els) {
        el.style.transition = "none";
        el.style.transform = `translateY(${delta}px)`;
      }
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          for (const el of els) {
            el.style.transition = `transform ${MS}ms ease-out`;
            el.style.transform = "translateY(0)";
          }
        }),
      );
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
}
