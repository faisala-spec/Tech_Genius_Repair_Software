"use client";

import { useEffect, useRef } from "react";

/**
 * Prints the 62 mm ticket label without opening a new tab: the label page loads in a
 * hidden frame and prints itself (it calls window.print() on load). Pick the QL-800
 * once in the print dialog; the browser remembers it.
 */
export function printLabel(ticketId: string) {
  document.getElementById("tg-label-frame")?.remove();
  const frame = document.createElement("iframe");
  frame.id = "tg-label-frame";
  frame.src = `/print/label/${ticketId}`;
  frame.setAttribute("aria-hidden", "true");
  Object.assign(frame.style, { position: "fixed", right: "0", bottom: "0", width: "1px", height: "1px", border: "0", opacity: "0" });
  document.body.appendChild(frame);
  // Clean up a minute later; the print dialog is long done by then.
  setTimeout(() => frame.remove(), 60_000);
}

export default function PrintLabelButton({ ticketId, className, auto = false, children = "Print label" }: { ticketId: string; className?: string; auto?: boolean; children?: React.ReactNode }) {
  const done = useRef(false);
  useEffect(() => {
    if (auto && !done.current) {
      done.current = true;
      printLabel(ticketId);
      // Drop ?print=1 so a refresh doesn't print a second label.
      const url = new URL(window.location.href);
      url.searchParams.delete("print");
      window.history.replaceState(null, "", url.toString());
    }
  }, [auto, ticketId]);
  return (
    <button type="button" onClick={() => printLabel(ticketId)} className={className}>
      {children}
    </button>
  );
}
