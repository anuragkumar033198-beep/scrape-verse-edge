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
- [x] Uses Bright Data Scraper Studio to create and run a custom scraper
- [x] Demo video 
- [x] Structured output examples

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
```text
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
```

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


[▶️ Watch the demo](https://youtu.be/9fXfVC2laRM)

## 📊 Example structured output


```json
[
  {
  "jobId": "83392acc-3edc-42e3-b86e-34db4760ea1b",
  "targetUrl": "https://news.ycombinator.com",
  "selector": "tr.athing",
  "recordCount": 30,
  "completedAt": "2026-08-17T08:19:18.886Z",
  "records": [
    {
      "text": "Qwen 3.8 27B is excellent, but it defaults to overthinking things",
      "href": "https://simonwillison.net/2026/Aug/16/qwen-38-27b/",
      "input": {
        "url": "https://news.ycombinator.com",
        "selector": "tr.athing"
      }
    },
    {
      "text": "GIMP Development Update",
      "href": "https://www.gimp.org/news/2026/08/16/dev-update-august-2026/",
      "input": {
        "url": "https://news.ycombinator.com",
        "selector": "tr.athing"
      }
    },
    {
      "text": "A third world engineer responds to “RISC-V: They should have known better”",
      "href": "https://rvembedded.com/blog_post/12/",
      "input": {
        "url": "https://news.ycombinator.com",
        "selector": "tr.athing"
      }
    },
    {
      "text": "On A.I. regulation and messaging",
      "href": "https://twitter.com/DarioAmodei/status/2088758816376807762",
      "input": {
        "url": "https://news.ycombinator.com",
        "selector": "tr.athing"
      }
    },
    {
      "text": "Linear algebra done right",
      "href": "https://linear.axler.net/",
      "input": {
        "url": "https://news.ycombinator.com",
        "selector": "tr.athing"
      }
    },
    {
      "text": "Anthropic's 'Watermark' Text Adulteration in Claude Is a Perversion of Writing",
      "href": "https://daringfireball.net/2026/08/anthropics_watermark_text_adulteration_in_claude_is_a_perversion_of_writing",
      "input": {
        "url": "https://news.ycombinator.com",
        "selector": "tr.athing"
      }
    },
    {
      "text": "Reticulum – Decentralized Mesh Network",
      "href": "https://reticulum.network/",
      "input": {
        "url": "https://news.ycombinator.com",
        "selector": "tr.athing"
      }
    },
    {
      "text": "Claude: System Prompts",
      "href": "https://platform.claude.com/docs/en/release-notes/system-prompts",
      "input": {
        "url": "https://news.ycombinator.com",
        "selector": "tr.athing"
      }
    },
    {
      "text": "AGI-64 Brings Sierra Adventures to the Commodore 64",
      "href": "https://meanhamster.com/news/agi-64-brings-sierra-adventures-to-the-commodore-64",
      "input": {
        "url": "https://news.ycombinator.com",
        "selector": "tr.athing"
      }
    },
    {
      "text": "Show HN: Vocal Slice – Cut audio by selecting text, fully on-device",
      "href": "https://vocalslice.com/",
      "input": {
        "url": "https://news.ycombinator.com",
        "selector": "tr.athing"
      }
    },
    {
      "text": "Rhombus 1.1 is now available",
      "href": "https://blog.racket-lang.org/2026/08/rhombus-v1.1.html",
      "input": {
        "url": "https://news.ycombinator.com",
        "selector": "tr.athing"
      }
    },
    {
      "text": "Gakutensoku",
      "href": "https://en.wikipedia.org/wiki/Gakutensoku",
      "input": {
        "url": "https://news.ycombinator.com",
        "selector": "tr.athing"
      }
    },
    {
      "text": "Low-Tech Ceramic Water Filter",
      "href": "https://wiki.lowtechlab.org/wiki/Filtre_%C3%A0_eau_c%C3%A9ramique/en",
      "input": {
        "url": "https://news.ycombinator.com",
        "selector": "tr.athing"
      }
    },
    {
      "text": "How do I permanently disable random Google Photos popup to backup photos? (2024)",
      "href": "https://support.google.com/photos/thread/256212140/how-do-i-permanently-disable-google-photos-pop-up-prompt-to-backup-my-photos-i?hl=en",
      "input": {
        "url": "https://news.ycombinator.com",
        "selector": "tr.athing"
      }
    },
    {
      "text": "SIMD in the 90s: Programming Intel's Pentium MMX",
      "href": "https://pikuma.com/blog/programming-intel-pentium-mmx-simd",
      "input": {
        "url": "https://news.ycombinator.com",
        "selector": "tr.athing"
      }
    },
    {
      "text": "Applying a photosynthetic process to treat “dry eye”",
      "href": "https://www.science.org/content/blog-post/taking-tip-plants-eyes",
      "input": {
        "url": "https://news.ycombinator.com",
        "selector": "tr.athing"
      }
    },
    {
      "text": "Prolly: A content-addressed ordered map built on prolly trees",
      "href": "https://github.com/crabbuild/prolly",
      "input": {
        "url": "https://news.ycombinator.com",
        "selector": "tr.athing"
      }
    },
    {
      "text": "Interview with Amit Patel, Creator of “Solar Realms Elite” (2013)",
      "href": "https://breakintochat.com/blog/2013/02/18/amit-patel-creator-of-solar-realms-elite/",
      "input": {
        "url": "https://news.ycombinator.com",
        "selector": "tr.athing"
      }
    },
    {
      "text": "Design 3D-printable parts by talking",
      "href": "https://nurb.dev/",
      "input": {
        "url": "https://news.ycombinator.com",
        "selector": "tr.athing"
      }
    },
    {
      "text": "Dancing with friends and enemies: boids' swarm intelligence (2012)",
      "href": "https://community.wolfram.com/groups/-/m/t/122095",
      "input": {
        "url": "https://news.ycombinator.com",
        "selector": "tr.athing"
      }
    },
    {
      "text": "Strong gravitational lensing and microlensing of supernovae (2024)",
      "href": "https://infoscience.epfl.ch/entities/publication/644cad8a-6c9b-4b02-bcf3-b8b6e8c614c5",
      "input": {
        "url": "https://news.ycombinator.com",
        "selector": "tr.athing"
      }
    },
    {
      "text": "$12B of US ratepayers' money wasted on a modeling mistake in PJM",
      "href": "https://newsletter.semianalysis.com/p/12b-of-us-ratepayers-money-wasted",
      "input": {
        "url": "https://news.ycombinator.com",
        "selector": "tr.athing"
      }
    },
    {
      "text": "The AI Credit Resale Economy",
      "href": "https://vectoral.com/blog/who-are-the-token-brokers",
      "input": {
        "url": "https://news.ycombinator.com",
        "selector": "tr.athing"
      }
    },
    {
      "text": "The Life and Death of Direct File [pdf]",
      "href": "https://www.ischool.berkeley.edu/sites/default/files/vinton_report_5.pdf",
      "input": {
        "url": "https://news.ycombinator.com",
        "selector": "tr.athing"
      }
    },
    {
      "text": "Protobuf has LSP support",
      "href": "https://buf.build/blog/protobuf-lsp",
      "input": {
        "url": "https://news.ycombinator.com",
        "selector": "tr.athing"
      }
    },
    {
      "text": "MathCode, Mathematical Coding Agent",
      "href": "https://math-ai-org.github.io/mathcode/",
      "input": {
        "url": "https://news.ycombinator.com",
        "selector": "tr.athing"
      }
    },
    {
      "text": "Red queen hypothesis – A new way forward for self-improving AI",
      "href": "https://www.cst.cam.ac.uk/news/red-queen-hypothesis-new-way-forward-self-improving-ai",
      "input": {
        "url": "https://news.ycombinator.com",
        "selector": "tr.athing"
      }
    },
    {
      "text": "Tell HN: Cloudflare silently injects its analytics when you switch nameservers",
      "href": "item?id=49322107",
      "input": {
        "url": "https://news.ycombinator.com",
        "selector": "tr.athing"
      }
    },
    {
      "text": "Stripe will reportedly acquire OpenRouter for $7B+",
      "href": "https://techcrunch.com/2026/08/16/stripe-will-reportedly-acquire-ai-gateway-startup-openrouter-for-7b/",
      "input": {
        "url": "https://news.ycombinator.com",
        "selector": "tr.athing"
      }
    },
    {
      "text": "Plastic mechanical computer from 1963: The Digi-Comp 1 [video]",
      "href": "https://www.youtube.com/watch?v=-y8bGBE71yw",
      "input": {
        "url": "https://news.ycombinator.com",
        "selector": "tr.athing"
      }
  }
]

```

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

## 🚀 Setup & installation

**Prerequisites**
* Android device with Termux
* Node.js 18+ (`pkg install nodejs-lts`)
* Chromium in Termux (`pkg install chromium`)
* Bright Data account with a published Scraper Studio collector
* OpenAI and/or Gemini API key
* Vercel account

**1. Backend (Termux)**
```bash
pkg update -y && pkg upgrade -y
pkg install -y nodejs-lts chromium git

git clone https://github.com/anuragkumar033198-beep/scrape-verse-edge.git scrape-verse
cd scrape-verse/termux-backend

npm install

cp .env.example .env
nano .env
```

(Fill in ALLOWED_ORIGINS, OPENAI_API_KEY/GEMINI_API_KEY, BRIGHTDATA_API_TOKEN, BRIGHTDATA_COLLECTOR_ID)
```bash
termux-wake-lock
npm start
```

**2. Expose the backend with a tunnel**
```bash
cd scrape-verse/termux-backend
npm run tunnel
```

**3. Frontend (Vercel)**
```bash
cd scrape-verse/vercel-frontend
npx vercel@latest --prod
```

**4. Run it**
Paste the tunnel URL into the dashboard's Edge Endpoint field, enter a target URL, and tap Run Scraper.

##  ​🧩 Tech stack

* Frontend: Vanilla JS PWA, Socket.io client, service worker
* Backend: Node.js, Express, Socket.io
* Browser automation: Puppeteer-core (system Chromium)
* Selector healing: Gemini / OpenAI
* Structured extraction: Bright Data Scraper Studio
* Tunnel: localtunnel (self-reconnecting)
* Hosting: Vercel + Termux/Android

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

