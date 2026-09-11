"use client";

import { useEffect } from "react";

export function useBeforeUnload(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Requis par certains navigateurs pour afficher la confirmation
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [active]);
}
