"use client";

import { useEffect, type RefObject } from "react";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * While `active`, moves keyboard focus into `ref`, keeps Tab cycling inside it,
 * and puts focus back where it was when it closes. A dialog opened on top
 * (another aria-modal element holding focus) takes over until it closes.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const box = ref.current;
    if (!box) return;
    const before = document.activeElement as HTMLElement | null;
    const items = () => [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);

    // Respect autoFocus inside; otherwise focus the first control.
    if (!box.contains(document.activeElement)) (items()[0] ?? box).focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const cur = document.activeElement as HTMLElement | null;
      const otherModal = cur?.closest('[aria-modal="true"]');
      if (otherModal && otherModal !== box && !box.contains(otherModal)) return;
      const list = items();
      if (!list.length) return e.preventDefault();
      const first = list[0];
      const last = list[list.length - 1];
      if (!cur || !box.contains(cur)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && cur === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && cur === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (before && document.contains(before)) before.focus({ preventScroll: true });
    };
  }, [ref, active]);
}
