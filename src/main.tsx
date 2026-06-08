import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

const getOrCreateVisitorId = (): string => {
  let id = localStorage.getItem('pitchforge_visitor_id');
  if (!id) {
    id = `pf_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    localStorage.setItem('pitchforge_visitor_id', id);
  }
  return id;
};

const savedMeta = JSON.parse(localStorage.getItem('pitchforge_visitor_meta') || '{}');

pendo.initialize({
  visitor: {
    id: getOrCreateVisitorId(),
    ...(savedMeta.visitorName && { visitorName: savedMeta.visitorName }),
    ...(savedMeta.visitorRole && { visitorRole: savedMeta.visitorRole }),
  }
});

createRoot(document.getElementById("root")!).render(<App />);
