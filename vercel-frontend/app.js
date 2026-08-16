/* ===========================================================
   Scrape-Verse Edge Console — client logic
   Talks to the Termux Express/Socket.io backend over the
   configured tunnel URL (ngrok / localtunnel).
   =========================================================== */

(function () {
  "use strict";

  const els = {
    edgeUrl: document.getElementById("edgeUrl"),
    targetUrl: document.getElementById("targetUrl"),
    targetSelector: document.getElementById("targetSelector"),
    runBtn: document.getElementById("runBtn"),
    terminal: document.getElementById("terminal"),
    clearLogBtn: document.getElementById("clearLogBtn"),
    connStatus: document.getElementById("connStatus"),
    healCount: document.getElementById("healCount"),
    recordCount: document.getElementById("recordCount"),
    sessionState: document.getElementById("sessionState"),
    settingsBtn: document.getElementById("settingsBtn"),
    settingsOverlay: document.getElementById("settingsOverlay"),
    closeSettings: document.getElementById("closeSettings"),
    saveSettings: document.getElementById("saveSettings"),
    systemPrompt: document.getElementById("systemPrompt"),
    llmProvider: document.getElementById("llmProvider"),
    maxRetries: document.getElementById("maxRetries"),
  };

  const STORAGE_KEY = "scrapeverse.config.v1";
  let socket = null;
  let pollTimer = null;
  let healTotal = 0;
  let recordTotal = 0;
  let lastSeq = 0;

  /* ---------------- persistence ---------------- */

  function loadConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const cfg = JSON.parse(raw);
      if (cfg.edgeUrl) els.edgeUrl.value = cfg.edgeUrl;
      if (cfg.systemPrompt) els.systemPrompt.value = cfg.systemPrompt;
      if (cfg.llmProvider) els.llmProvider.value = cfg.llmProvider;
      if (cfg.maxRetries) els.maxRetries.value = cfg.maxRetries;
    } catch (err) {
      console.error("Failed to load stored config:", err);
    }
  }

  function saveConfig() {
    try {
      const cfg = {
        edgeUrl: els.edgeUrl.value.trim(),
        systemPrompt: els.systemPrompt.value,
        llmProvider: els.llmProvider.value,
        maxRetries: Number(els.maxRetries.value) || 3,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    } catch (err) {
      console.error("Failed to persist config:", err);
    }
  }

  /* ---------------- terminal rendering ---------------- */

  function timestamp() {
    const d = new Date();
    return d.toTimeString().split(" ")[0];
  }

  function appendLog(tag, message) {
    const line = document.createElement("div");
    line.className = "log-line";

    const time = document.createElement("span");
    time.className = "log-time";
    time.textContent = timestamp();

    const tagEl = document.createElement("span");
    tagEl.className = "log-tag " + tag;
    tagEl.textContent = tag.toUpperCase();

    const msg = document.createElement("span");
    msg.className = "log-msg";
    msg.textContent = message;

    line.appendChild(time);
    line.appendChild(tagEl);
    line.appendChild(msg);
    els.terminal.appendChild(line);
    els.terminal.scrollTop = els.terminal.scrollHeight;
  }

  els.clearLogBtn.addEventListener("click", () => {
    els.terminal.innerHTML = "";
  });

  /* ---------------- connection status ---------------- */

  function setConnState(online) {
    els.connStatus.dataset.state = online ? "online" : "offline";
    els.connStatus.querySelector(".label").textContent = online ? "LINK LIVE" : "LINK DOWN";
  }

  /* ---------------- socket.io realtime channel ---------------- */

  function connectSocket(baseUrl) {
    if (socket) {
      socket.disconnect();
      socket = null;
    }
    if (typeof io === "undefined") {
      appendLog("warn", "socket.io client not loaded, falling back to HTTP polling.");
      startPolling(baseUrl);
      return;
    }

    try {
      socket = io(baseUrl, {
        transports: ["polling"],
        extraHeaders: { "Bypass-Tunnel-Reminder": "true" },
        reconnectionAttempts: 5,
        timeout: 8000,
      });

      socket.on("connect", () => {
        setConnState(true);
        appendLog("ok", "Connected to edge worker via socket.io.");
        stopPolling();
        backfillMissedEvents(baseUrl);
      });

      socket.on("disconnect", () => {
        setConnState(false);
        appendLog("warn", "Disconnected from edge worker.");
      });

      socket.on("connect_error", (err) => {
        setConnState(false);
        appendLog("err", "Socket connect error: " + err.message);
        startPolling(baseUrl);
      });

      socket.on("scraper:log", (payload) => {
        handleEvent(payload);
      });
    } catch (err) {
      appendLog("err", "Failed to init socket: " + err.message);
      startPolling(baseUrl);
    }
  }

  /* ---------------- backfill on (re)connect ---------------- */

  async function backfillMissedEvents(baseUrl) {
    try {
      const res = await fetch(baseUrl.replace(/\/$/, "") + "/api/logs?since=" + lastSeq, {
        headers: { "Bypass-Tunnel-Reminder": "true" },
      });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.events)) {
        data.events.forEach(handleEvent);
      }
    } catch (err) {
      // Non-fatal: if backfill fails we simply resume from live events.
      console.error("Backfill failed:", err);
    }
  }

  /* ---------------- HTTP polling fallback ---------------- */

  function startPolling(baseUrl) {
    stopPolling();
    pollTimer = setInterval(async () => {
      try {
        const res = await fetch(baseUrl.replace(/\/$/, "") + "/api/logs?since=" + lastSeq, {
          headers: { "Bypass-Tunnel-Reminder": "true" },
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        setConnState(true);
        if (Array.isArray(data.events)) {
          data.events.forEach(handleEvent);
        }
      } catch (err) {
        setConnState(false);
      }
    }, 2500);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  /* ---------------- event handling ---------------- */

  function handleEvent(payload) {
    if (!payload || typeof payload !== "object") return;

    if (typeof payload.seq === "number") {
      if (payload.seq <= lastSeq) return; // already processed via live socket or backfill
      lastSeq = payload.seq;
    }

    const tag = payload.type || "info";
    const message = payload.message || "";

    appendLog(tag, message);

    if (tag === "heal") {
      healTotal += 1;
      els.healCount.textContent = String(healTotal);
    }
    if (typeof payload.recordsFound === "number") {
      recordTotal += payload.recordsFound;
      els.recordCount.textContent = String(recordTotal);
    }
    if (payload.sessionState) {
      els.sessionState.textContent = payload.sessionState;
    }
    if (payload.sessionState === "complete" || payload.sessionState === "error") {
      els.runBtn.disabled = false;
    }
  }

  /* ---------------- run scraper ---------------- */

  els.runBtn.addEventListener("click", async () => {
    const edgeUrl = els.edgeUrl.value.trim();
    const targetUrl = els.targetUrl.value.trim();
    const targetSelector = els.targetSelector.value.trim();

    if (!edgeUrl) {
      appendLog("err", "Set the edge endpoint (your ngrok/localtunnel URL) first.");
      return;
    }
    if (!targetUrl) {
      appendLog("err", "Enter a target URL to scrape.");
      return;
    }

    saveConfig();
    connectSocket(edgeUrl);

    els.runBtn.disabled = true;
    els.sessionState.textContent = "starting";
    appendLog("info", "Dispatching run request to edge worker...");

    try {
      const res = await fetch(edgeUrl.replace(/\/$/, "") + "/api/scrape", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Bypass-Tunnel-Reminder": "true",
        },
        body: JSON.stringify({
          targetUrl: targetUrl,
          seedSelector: targetSelector || null,
          systemPrompt: els.systemPrompt.value || null,
          llmProvider: els.llmProvider.value,
          maxRetries: Number(els.maxRetries.value) || 3,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error("HTTP " + res.status + ": " + text);
      }

      const data = await res.json();
      appendLog("info", "Run accepted, job id " + (data.jobId || "unknown") + ".");
    } catch (err) {
      appendLog("err", "Failed to start run: " + err.message);
      els.runBtn.disabled = false;
      els.sessionState.textContent = "error";
    }
  });

  /* ---------------- settings overlay ---------------- */

  function openSettingsPanel() {
    els.settingsOverlay.hidden = false;
    els.settingsOverlay.style.display = "flex";
  }

  function closeSettingsPanel() {
    els.settingsOverlay.hidden = true;
    els.settingsOverlay.style.display = "none";
  }

  els.settingsBtn.addEventListener("click", () => {
    openSettingsPanel();
  });

  els.closeSettings.addEventListener("click", () => {
    closeSettingsPanel();
  });

  els.settingsOverlay.addEventListener("click", (e) => {
    if (e.target === els.settingsOverlay) closeSettingsPanel();
  });

  els.saveSettings.addEventListener("click", () => {
    saveConfig();
    closeSettingsPanel();
    appendLog("ok", "Agent configuration saved.");
  });

  /* ---------------- init ---------------- */

  loadConfig();
  appendLog("info", "Console ready. Set the edge endpoint and target URL to begin.");

  if (els.edgeUrl.value.trim()) {
    connectSocket(els.edgeUrl.value.trim());
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch((err) => {
        console.error("Service worker registration failed:", err);
      });
    });
  }
})();
