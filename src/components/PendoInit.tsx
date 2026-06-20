"use client";

import { useEffect } from "react";

const VISITOR_ID_KEY = "pitchforge_visitor_id";

function getOrCreateVisitorId(): string {
  let id = localStorage.getItem(VISITOR_ID_KEY);
  if (!id) {
    id = "anon-" + crypto.randomUUID();
    localStorage.setItem(VISITOR_ID_KEY, id);
  }
  return id;
}

export function PendoInit() {
  useEffect(() => {
    const pendo = (window as any).pendo;
    if (!pendo?.initialize) return;

    const visitorId = getOrCreateVisitorId();

    // Re-hydrate any visitor metadata saved during a previous session setup
    let visitorMeta: { visitorName?: string; visitorRole?: string } = {};
    try {
      const raw = localStorage.getItem("pitchforge_visitor_meta");
      if (raw) visitorMeta = JSON.parse(raw);
    } catch {
      // ignore parse errors
    }

    pendo.initialize({
      visitor: {
        id: visitorId,
        ...(visitorMeta.visitorName && { visitorName: visitorMeta.visitorName }),
        ...(visitorMeta.visitorRole && { visitorRole: visitorMeta.visitorRole }),
      },
      account: {
        id: "PITCHFORGE",
      },
    });
  }, []);

  return null;
}
