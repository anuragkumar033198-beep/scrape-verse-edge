"use strict";

require("dotenv").config();
const localtunnel = require("localtunnel");

/* ===========================================================
   Standalone tunnel launcher with automatic reconnect and a
   keep-alive ping.

   Uses the localtunnel library API directly instead of the
   `lt` CLI, because the CLI unconditionally requires `openurl`
   to auto-open a browser tab, and openurl throws "Unsupported
   platform: android" on Termux. The library itself has no such
   check.

   The free .loca.lt relay can enter a state where its control
   connection still looks "alive" (no close/error event fires)
   while the actual public routing has gone unreachable. A ping
   to localhost alone can't detect this, since it never touches
   the tunnel. So the keep-alive pings BOTH localhost and the
   public tunnel URL separately, logs which one fails, and if
   the public URL specifically fails repeatedly, forces the
   tunnel closed to trigger a real reconnect — closing the blind
   spot where the tunnel looks fine but isn't actually working.
   =========================================================== */

const PORT = Number(process.env.PORT) || 4000;
const MAX_BACKOFF_MS = 30000;
let backoffMs = 1000;
let shuttingDown = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startTunnel() {
  while (!shuttingDown) {
    try {
      const tunnel = await localtunnel({ port: PORT });

      backoffMs = 1000; // reset backoff on a successful connection
      console.log(`Tunnel is live: ${tunnel.url}`);
      console.log("Paste this URL into the dashboard's EDGE ENDPOINT field.");
      console.log("Press Ctrl+C to stop the tunnel.");

      let consecutivePublicFailures = 0;
      const MAX_PUBLIC_FAILURES = 3; // ~3 minutes of unreachability before forcing a reconnect

      const keepAlive = setInterval(async () => {
        try {
          await fetch(`http://localhost:${PORT}/api/health`);
        } catch (err) {
          console.error("Keep-alive: localhost ping failed —", err.message);
        }

        try {
          const res = await fetch(`${tunnel.url}/api/health`, {
            headers: { "Bypass-Tunnel-Reminder": "true" },
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          consecutivePublicFailures = 0;
        } catch (err) {
          consecutivePublicFailures += 1;
          console.error(
            `Keep-alive: public URL ping failed (${consecutivePublicFailures}/${MAX_PUBLIC_FAILURES}) —`,
            err.message
          );
          if (consecutivePublicFailures >= MAX_PUBLIC_FAILURES) {
            console.error("Public URL unreachable for too long. Forcing reconnect...");
            clearInterval(keepAlive);
            tunnel.close();
          }
        }
      }, 60000); // every 60s, well under localtunnel's idle-drop window

      const closed = new Promise((resolve) => {
        tunnel.on("close", () => {
          clearInterval(keepAlive);
          console.log("Tunnel closed. Reconnecting...");
          resolve();
        });
        tunnel.on("error", (err) => {
          clearInterval(keepAlive);
          console.error("Tunnel error:", err.message, "- reconnecting...");
          resolve();
        });
      });

      process.once("SIGINT", () => {
        console.log("\nShutting down tunnel...");
        shuttingDown = true;
        tunnel.close();
        process.exit(0);
      });

      await closed; // wait here until this tunnel instance drops, then loop
    } catch (err) {
      console.error(`Failed to open tunnel: ${err.message}. Retrying in ${backoffMs}ms...`);
      await sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    }
  }
}

startTunnel();
