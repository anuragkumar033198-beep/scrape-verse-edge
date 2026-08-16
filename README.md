# Scrape-Verse Edge Console 🛰️
### A self-healing web scraper that lives in your pocket

An LLM-assisted, self-healing scraper with an edge worker running natively
on an **Android tablet inside Termux** — no cloud server, no VM, no
container. When a target site changes its layout, the scraper snapshots
the page, asks an LLM to propose a fixed selector, and hands the healed
selector to **Bright Data Scraper Studio** for the actual structured
extraction. A Vercel-hosted PWA dashboard streams the whole process live.

Built for **Into the Scrape-Verse 2026**.

---

## ✅ Hackathon requirements checklist

- [x] Public source-code repository (this repo)
- [x] Clear README (this file)
- [x] Uses Bright Data Scraper Studio to create and run a custom scraper — see [How Bright Data Is Used](#-how-bright-data-scraper-studio-is-used)
- [ ] Demo video — [add your link here](#-demo-video)
- [ ] Structured output examples — [add yours here](#-example-structured-output)

---

## 🧠 The idea

Most scrapers break the moment a site redesigns its markup. This one
doesn't wait for a human to notice and patch a selector:

1. The edge worker tries a set of default/seed CSS selectors.
2. If none match, it captures a trimmed accessibility tree + HTML snapshot
   of the page.
3. That snapshot goes to an LLM (Gemini or OpenAI) with a prompt asking
   for a replacement selector and a one-line justification.
4. The healed selector is verified locally, then handed to a **published
   Bright Data Scraper Studio collector**, which performs the real
   structured extraction run.
5. Every step streams live to the dashboard: navigation, healing,
   reasoning, and final structured records.

## 🗺️ Workflow
┌─────────────────────┐        ┌───────────────┐        ┌──────────────────────────────┐
│  Vercel PWA          │  WS/   │  Localtunnel  │  HTTP  │  Termux Edge Worker            │
│  Dashboard            │◄──────►│  (public URL) │◄──────►│  (Android tablet)              │
│  (app.js, Socket.io)  │  HTTP  │               │        │  Express + Socket.io + Puppeteer│
└──────────┬────────────┘        └───────────────┘        └───────────────┬───────────────┘
│                                                              │
│ live log stream                                             │ 1. probe/heal locally
▼                                                              ▼
Selector heals, records                                    ┌─────────────────────────┐
pulled, session state                                       │  Gemini / OpenAI          │
│  (selector healing only) │
└─────────────┬─────────────┘
│ 2. healed selector
▼
┌─────────────────────────┐
│  Bright Data Scraper     │
│  Studio Collector         │
│  (production extraction) │
└─────────────────────────┘

**Frontend → Localtunnel → Termux Backend → Gemini Healing → Bright Data**

- The **frontend** never talks to the LLM or Bright Data directly — it only
  talks to the Termux backend over the tunnel.
- The **Termux backend** owns the whole pipeline: navigate, probe, heal,
  extract.
- **Gemini/OpenAI** is only ever used for the narrow task of proposing a
  replacement selector from a DOM snapshot — it never sees or handles the
  actual scraped data.
- **Bright Data Scraper Studio** is the system of record for the final
  structured output — the healed selector is handed off to a published
  collector, which performs the actual production-grade extraction run.

## 🟢 How Bright Data Scraper Studio is used

This project satisfies the mandatory Bright Data requirement as follows:

1. **A custom collector is built and published in Bright Data Scraper
   Studio's IDE** (`brightdata.js` / Collector ID `c_...`), configured to
   accept `{ url, selector }` as its input row and extract matching
   records using that selector.
2. Once the Termux edge worker's local Puppeteer probe confirms a selector
   is valid (either a seed default or an LLM-healed one), the backend
   calls `POST /dca/trigger?collector=<id>` with that `{ url, selector }`
   pair via `runCollector()` in `termux-backend/brightdata.js`.
3. The backend polls `GET /dca/dataset?id=<snapshot_id>` until Bright Data
   returns the finished, structured dataset.
4. That structured dataset — not the local Puppeteer extraction — is what
   gets streamed to the dashboard and counted in "Records pulled." Local
   extraction is used only as a fallback if Bright Data credentials aren't
   configured, and is clearly labeled as a fallback in the live log when
   that happens.

In short: **the AI/edge layer decides *where* to look; Bright Data does
the actual looking.**

Credentials required in `termux-backend/.env`:
BRIGHTDATA_API_TOKEN=your_api_token
BRIGHTDATA_COLLECTOR_ID=c_your_collector_id

## 🎥 Demo video


[▶️ Watch the demo](#)

## 📊 Example structured output


```json
[
  {
    "example": "replace this block with real output from your run"
  }
]

🏗️ Architecture
scrape-verse/
├── vercel-frontend/       # PWA dashboard — deploy to Vercel
│   ├── index.html
│   ├── style.css
│   ├── app.js              # Socket.io client, run controls, live log
│   ├── manifest.json
│   ├── sw.js                # network-first service worker
│   └── vercel.json
└── termux-backend/        # Edge worker — runs inside Termux on Android
    ├── server.js            # Express + Socket.io, CORS, REST endpoints
    ├── scraper.js           # probe → heal → Bright Data extraction pipeline
    ├── brightdata.js        # Bright Data Scraper Studio API client
    ├── tunnel.js             # self-reconnecting localtunnel launcher
    ├── package.json
    └── .env.example

Why an Android tablet, not a cloud VM?
The "edge" in this project is literal: the scraping browser runs on
physical hardware you carry, not a rented server.
Resilience features
Self-reconnecting tunnel — automatically retries with backoff, and
independently pings the public tunnel URL to catch cases where the
control connection looks alive but is actually unreachable.
Sequence-numbered event backfill — a dropped/reconnected socket
replays exactly what it missed, no healing events silently lost.
Automatic LLM provider fallback — switches provider automatically
if the selected one's API key isn't configured.
Compliant backoff on rate-limiting — exponential backoff + jitter,
optional authorized proxy rotation. No device-level network evasion.

🚀 Setup & installation
Prerequisites
Android device with Termux
Node.js 18+ (pkg install nodejs-lts)
Chromium in Termux (pkg install chromium)
Bright Data account with a published Scraper Studio collector
OpenAI and/or Gemini API key
Vercel account
1. Backend (Termux)
pkg update -y && pkg upgrade -y
pkg install -y nodejs-lts chromium git

git clone <your-repo-url> scrape-verse
cd scrape-verse/termux-backend

npm install

cp .env.example .env
nano .env
# Fill in ALLOWED_ORIGINS, OPENAI_API_KEY/GEMINI_API_KEY,
# BRIGHTDATA_API_TOKEN, BRIGHTDATA_COLLECTOR_ID

termux-wake-lock
npm start
2. Expose the backend with a tunnel
cd scrape-verse/termux-backend
npm run tunnel
3. Frontend (Vercel)
cd scrape-verse/vercel-frontend
npx vercel@latest --prod
4. Run it
Paste the tunnel URL into the dashboard's Edge Endpoint field, enter a
target URL, tap Run Scraper.

🧩 Tech stack

Layer                   Tech
Frontend               Vanilla JS PWA, Socket.io client, service worker
Backend                Node.js, Express, Socket.io
Browser automation     Puppeteer-core (system Chromium)
Selector healing       Gemini / OpenAI
Structured extraction  Bright Data Scraper Studio
Tunnel                 localtunnel (self-reconnecting)
Hosting                Vercel + Termux/Android

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

