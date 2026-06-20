// Vercel serverless function — REST API proxy (no WebSocket).
// API keys stay server-side, never exposed to the browser.
//
// For WebSocket (Live API), deploy server/index.js separately.

import app from "../server/app.js";

export default app;
