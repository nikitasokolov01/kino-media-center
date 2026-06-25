// Click-and-drag horizontal scrolling for media rows.
//
// Returns a callback ref to attach to a horizontally-scrollable element. The
// callback-ref form re-attaches automatically when the node mounts/unmounts
// (media strips are conditionally rendered after their data loads).
//
// Behavior:
//   - Press and drag to scroll the row left/right (cursor: grabbing).
//   - A small movement threshold distinguishes a drag from a click, so cards
//     still open on a genuine click but a drag never triggers navigation.
//   - Drags that begin on a form control (input/select/textarea/button) are
//     ignored so interactive children keep working.
//   - Native browser drag-and-drop (image/link ghost) is suppressed via a
//     dragstart preventer, so a horizontal drag never starts a link/image drag.
//   - Drag state is cleaned up on pointerup, pointercancel, lostpointercapture,
//     and window blur, so the row can never get stuck in drag mode.
//   - Native wheel/trackpad scrolling is untouched.

import { useCallback, useRef } from "react";

const DRAG_THRESHOLD_PX = 6;

export function useDragScroll<T extends HTMLElement = HTMLDivElement>() {
  const cleanupRef = useRef<(() => void) | null>(null);

  return useCallback((node: T | null) => {
    // Detach from any previous node first.
    cleanupRef.current?.();
    cleanupRef.current = null;
    if (!node) return;

    let down = false;
    let moved = false;
    let startX = 0;
    let startScroll = 0;
    let pointerId = -1;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (target && target.closest("input, select, textarea")) return;
      down = true;
      moved = false;
      startX = e.clientX;
      startScroll = node.scrollLeft;
      pointerId = e.pointerId;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!down) return;
      const dx = e.clientX - startX;
      if (!moved && Math.abs(dx) > DRAG_THRESHOLD_PX) {
        moved = true;
        node.classList.add("is-grabbing");
        try { node.setPointerCapture(pointerId); } catch { /* ignore */ }
      }
      if (moved) {
        node.scrollLeft = startScroll - dx;
        e.preventDefault();
      }
    };

    const endDrag = () => {
      if (!down) return;
      down = false;
      node.classList.remove("is-grabbing");
      try { if (pointerId >= 0) node.releasePointerCapture(pointerId); } catch { /* ignore */ }
      if (moved) {
        // Suppress the click that fires after a drag (capture phase below).
        node.dataset.dragged = "1";
      }
      moved = false;
      pointerId = -1;
    };

    // Capture-phase click handler: cancel the click only if we just dragged.
    const onClickCapture = (e: MouseEvent) => {
      if (node.dataset.dragged === "1") {
        e.preventDefault();
        e.stopPropagation();
        delete node.dataset.dragged;
      }
    };

    // Suppress native image/link drag so a horizontal drag never starts a
    // browser drag-and-drop "ghost" (which would also cancel our pointer
    // stream and leave the row stuck in drag mode).
    const onDragStart = (e: DragEvent) => {
      e.preventDefault();
    };

    node.addEventListener("pointerdown", onPointerDown);
    node.addEventListener("pointermove", onPointerMove);
    node.addEventListener("pointerup", endDrag);
    node.addEventListener("pointercancel", endDrag);
    node.addEventListener("lostpointercapture", endDrag);
    node.addEventListener("dragstart", onDragStart);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("blur", endDrag);
    node.addEventListener("click", onClickCapture, true);

    cleanupRef.current = () => {
      // Ensure we never leave the grabbing state/flag behind on unmount.
      node.classList.remove("is-grabbing");
      delete node.dataset.dragged;
      node.removeEventListener("pointerdown", onPointerDown);
      node.removeEventListener("pointermove", onPointerMove);
      node.removeEventListener("pointerup", endDrag);
      node.removeEventListener("pointercancel", endDrag);
      node.removeEventListener("lostpointercapture", endDrag);
      node.removeEventListener("dragstart", onDragStart);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("blur", endDrag);
      node.removeEventListener("click", onClickCapture, true);
    };
  }, []);
}
