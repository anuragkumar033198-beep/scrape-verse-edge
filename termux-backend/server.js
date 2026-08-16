"use strict";

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const { runScrapeJob } = require("./scraper");

const PORT = process.env.PORT || 4000;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const app = express();
app.use(express.json({ limit: "2mb" }));

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("Origin not allowed by CORS: " + origin));
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Bypass-Tunnel-Reminder"],
};

app.use(cors(corsOptions));

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} origin=${req.headers.origin || "(none)"}`);
  next();
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS.length === 0 ? "*" : ALLOWED_ORIGINS,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization", "Bypass-Tunnel-Reminder"],
  },
});

io.engine.on("connection_error", (err) => {
  console.log("[engine.io connection_error]", {
    code: err.code,
    message: err.message,
    context: err.context,
    reqUrl: err.req ? err.req.url : undefined,
  });
});

const MAX_BUFFERED_EVENTS = 500;
const eventBuffer = [];
let nextSeq = 1;

function emitEvent(payload) {
  const enriched = Object.assign({ ts: Date.now(), seq: nextSeq++ }, payload);
  eventBuffer.push(enriched);
  if (eventBuffer.length > MAX_BUFFERED_EVENTS) {
    eventBuffer.shift();
  }
  io.emit("scraper:log", enriched);
}

io.on("connection", (socket) => {
  emitEvent({ type: "info", message: `Client connected: ${socket.id}` });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", uptimeSeconds: process.uptime() });
});

app.get("/api/logs", (req, res) => {
  const sinceSeq = Number(req.query.since) || 0;
  const events = eventBuffer.filter((e) => e.seq > sinceSeq);
  res.json({ events });
});

app.post("/api/scrape", async (req, res) => {
  try {
    const { targetUrl, seedSelector, systemPrompt, llmProvider, maxRetries } = req.body || {};

    if (!targetUrl || typeof targetUrl !== "string") {
      return res.status(400).json({ error: "targetUrl is required." });
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(targetUrl);
    } catch (err) {
      return res.status(400).json({ error: "targetUrl is not a valid URL." });
    }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return res.status(400).json({ error: "targetUrl must be http or https." });
    }

    const jobId = crypto.randomUUID();
    res.json({ jobId, status: "accepted" });

    emitEvent({ type: "info", message: `Job ${jobId} accepted for ${targetUrl}`, sessionState: "queued" });

    runScrapeJob(
      {
        targetUrl,
        seedSelector: seedSelector || null,
        systemPrompt: systemPrompt || null,
        llmProvider: llmProvider === "gemini" ? "gemini" : "openai",
        maxRetries: Number.isFinite(Number(maxRetries)) ? Math.max(1, Math.min(10, Number(maxRetries))) : 3,
      },
      emitEvent
    ).catch((err) => {
      emitEvent({ type: "err", message: `Job ${jobId} crashed: ${err.message}`, sessionState: "error" });
    });
  } catch (err) {
    console.error("Unhandled /api/scrape error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error." });
    }
  }
});

app.use((req, res) => {
  res.status(404).json({ error: "Not found." });
});

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  if (!res.headersSent) {
    res.status(500).json({ error: err.message || "Internal server error." });
  }
});

server.listen(PORT, () => {
  console.log(`Edge worker listening on port ${PORT}`);
  console.log(`Allowed origins: ${ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS.join(", ") : "(all — set ALLOWED_ORIGINS for production)"}`);
});
