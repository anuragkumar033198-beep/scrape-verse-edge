"use strict";

const puppeteer = require("puppeteer-core");
const { runCollector: runBrightDataCollector } = require("./brightdata");
const cheerio = require("cheerio");

/* ===========================================================
   Self-healing scraper engine (Puppeteer-core edition)
   -----------------------------------------------------------
   Runs against the Chromium binary installed via `pkg install
   chromium` in Termux. puppeteer-core is used instead of
   Playwright because playwright-core's internal platform check
   throws "Unsupported platform: android" regardless of a custom
   executablePath. puppeteer-core has no such gate — it just
   spawns whatever binary you point it at.

   Flow per job:
     1. Launch headless Chromium and navigate to targetUrl.
     2. Try the seed selector (or a list of sensible defaults).
     3. If nothing matches, snapshot a simplified accessibility
        tree + trimmed HTML, hand it to the configured LLM, and
        ask for a replacement CSS selector.
     4. Retry with the healed selector, up to maxRetries times.
     5. If the target responds with a rate-limit / block signal
        (HTTP 429/403, or a CAPTCHA-shaped page), back off with
        exponential delay + jitter and optionally rotate through
        a user-supplied, authorized proxy list. This project does
        NOT attempt to spoof or evade site-level protections by
        cycling the device's own network identity.
   =========================================================== */

const CHROMIUM_PATH = "/data/data/com.termux/files/usr/bin/chromium-browser";
const DEFAULT_CANDIDATE_SELECTORS = [
  "[data-item]",
  "article",
  "li[class*='item']",
  "div[class*='card']",
  "div[class*='product']",
  "section[class*='result']",
];

const BLOCK_STATUS_CODES = new Set([403, 429, 503]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(attempt) {
  const base = 800 * Math.pow(2, attempt); // 800ms, 1.6s, 3.2s, ...
  const jitter = Math.random() * 400;
  return Math.min(base + jitter, 15000);
}

function parseProxyList(rawList) {
  if (!rawList) return [];
  return rawList
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Launches a fresh Chromium instance for a single attempt. A new
 * instance (rather than a shared browser with new contexts) is used
 * because puppeteer-core's launch-time --proxy-server flag can't be
 * changed per-context the way Playwright's newContext({ proxy }) can.
 */
async function launchBrowser(proxyServer) {
  const args = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"];
  if (proxyServer) {
    args.push(`--proxy-server=${proxyServer}`);
  }
  return await puppeteer.launch({
    headless: true,
    executablePath: CHROMIUM_PATH,
    args,
  });
}

/**
 * Builds a compact, LLM-friendly snapshot of the page: a trimmed
 * accessibility-tree-style outline plus a size-capped HTML excerpt,
 * so we send the model enough signal to infer a new selector
 * without blowing the context budget.
 */
async function buildPageSnapshot(page) {
  const axTree = await page.accessibility.snapshot({ interestingOnly: true }).catch(() => null);

  function flattenAx(node, depth, lines) {
    if (!node || depth > 4) return;
    const role = node.role || "generic";
    const name = node.name ? ` "${node.name}"` : "";
    lines.push(`${"  ".repeat(depth)}- ${role}${name}`);
    if (Array.isArray(node.children)) {
      node.children.slice(0, 40).forEach((child) => flattenAx(child, depth + 1, lines));
    }
  }

  const axLines = [];
  if (axTree) flattenAx(axTree, 0, axLines);
  const axOutline = axLines.slice(0, 200).join("\n");

  const rawHtml = await page.content();
  const $ = cheerio.load(rawHtml);
  $("script, style, noscript, svg").remove();
  const bodyHtml = $.html($("body")).slice(0, 6000);

  return { axOutline, bodyHtml };
}

/**
 * Calls the configured LLM to propose a replacement CSS selector
 * given the page snapshot and the failed selector context.
 */
async function requestHealedSelector({ provider, systemPrompt, failedSelector, snapshot, targetUrl }) {
  const instructions =
    systemPrompt && systemPrompt.trim().length > 0
      ? systemPrompt.trim()
      : "You are a resilient web-extraction agent. Given a page's accessibility outline and trimmed HTML, " +
        "identify the CSS selector that best matches the repeating content items on the page (e.g. product " +
        "cards, article listings, search results). Respond with strict JSON only: " +
        '{"selector": "<css selector>", "reasoning": "<one short sentence>"}. ' +
        "Do not include markdown fences or any text outside the JSON object.";

  const userPrompt =
    `Target URL: ${targetUrl}\n` +
    `Previously failing selector: ${failedSelector || "(none provided)"}\n\n` +
    `Accessibility outline:\n${snapshot.axOutline}\n\n` +
    `Trimmed body HTML:\n${snapshot.bodyHtml}\n\n` +
    "Return the JSON object described in your instructions and nothing else.";

  if (provider === "gemini") {
    return await callGemini(instructions, userPrompt);
  }
  return await callOpenAI(instructions, userPrompt);
}

async function callOpenAI(systemPrompt, userPrompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set on the edge worker.");
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI request failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) throw new Error("OpenAI response missing content.");
  return parseSelectorJson(content);
}

async function callGemini(systemPrompt, userPrompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set on the edge worker.");
  }

const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${apiKey}`;  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json" },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini request failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  const content =
    data.candidates &&
    data.candidates[0] &&
    data.candidates[0].content &&
    data.candidates[0].content.parts &&
    data.candidates[0].content.parts[0] &&
    data.candidates[0].content.parts[0].text;
  if (!content) throw new Error("Gemini response missing content.");
  return parseSelectorJson(content);
}

function parseSelectorJson(rawContent) {
  const cleaned = rawContent.replace(/```json|```/g, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error("LLM did not return valid JSON: " + err.message);
  }
  if (!parsed.selector || typeof parsed.selector !== "string") {
    throw new Error("LLM response missing a usable 'selector' field.");
  }
  return parsed;
}

/**
 * Checks whether a selector matches anything on the page.
 * Disposes handles immediately since we only need the count.
 */
async function selectorMatches(page, selector) {
  try {
    const handles = await page.$$(selector);
    const count = handles.length;
    await Promise.all(handles.map((h) => h.dispose()));
    return count;
  } catch (err) {
    return 0;
  }
}

/**
 * Extracts a lightweight record set from the DOM given a CSS selector.
 */
async function extractRecords(page, selector) {
  return await page.$$eval(selector, (nodes) =>
    nodes.slice(0, 200).map((node) => ({
      text: (node.innerText || "").trim().slice(0, 400),
      href: node.querySelector && node.querySelector("a") ? node.querySelector("a").getAttribute("href") : null,
    }))
  );
}

async function detectBlockSignal(page, response) {
  const status = response ? response.status() : null;
  if (status && BLOCK_STATUS_CODES.has(status)) {
    return { blocked: true, reason: `HTTP ${status}` };
  }
  const bodyText = await page.evaluate(() => (document.body ? document.body.innerText.slice(0, 500) : ""));
  const lowered = bodyText.toLowerCase();
  if (lowered.includes("captcha") || lowered.includes("unusual traffic") || lowered.includes("access denied")) {
    return { blocked: true, reason: "content signature matched a block/CAPTCHA page" };
  }
  return { blocked: false, reason: null };
}

/**
 * Runs a full scrape job with self-healing and compliant backoff.
 * `emit(event)` is called for every log-worthy step; event shape:
 *   { type: 'info'|'ok'|'warn'|'err'|'heal', message, recordsFound?, sessionState? }
 */
async function runScrapeJob(options, emit) {
  const {
    targetUrl,
    seedSelector,
    systemPrompt,
    llmProvider = "openai",
    maxRetries = 3,
  } = options;

  const proxies = parseProxyList(process.env.PROXY_LIST);
  let proxyIndex = 0;

  let selectorCandidates = seedSelector
    ? [seedSelector, ...DEFAULT_CANDIDATE_SELECTORS]
    : [...DEFAULT_CANDIDATE_SELECTORS];
  let attempt = 0;
  let lastError = null;

  while (attempt <= maxRetries) {
    const proxyForAttempt = proxies.length > 0 ? proxies[proxyIndex % proxies.length] : null;
    let browser;

    try {
      emit({
        type: "info",
        message: `Launching headless Chromium for ${targetUrl} (attempt ${attempt + 1}/${maxRetries + 1})`,
        sessionState: "launching",
      });
      browser = await launchBrowser(proxyForAttempt);
      const page = await browser.newPage();

      emit({ type: "info", message: "Navigating...", sessionState: "navigating" });
      const response = await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

      const blockCheck = await detectBlockSignal(page, response);
      if (blockCheck.blocked) {
        emit({
          type: "warn",
          message: `Target signaled a block (${blockCheck.reason}). Backing off before retry.`,
          sessionState: "throttled",
        });
        await browser.close();
        proxyIndex += 1;
        const delay = backoffDelay(attempt);
        emit({ type: "info", message: `Waiting ${Math.round(delay)}ms before retry.` });
        await sleep(delay);
        attempt += 1;
        continue;
      }

      let matched = false;
      let usedSelector = null;
      for (const candidate of selectorCandidates) {
        const count = await selectorMatches(page, candidate);
        if (count > 0) {
          matched = true;
          usedSelector = candidate;
          break;
        }
      }

if (matched) {
        emit({
          type: "info",
          message: `Local probe confirmed selector "${usedSelector}". Triggering Bright Data Scraper Studio for production extraction...`,
        });

        const brightDataToken = process.env.BRIGHTDATA_API_TOKEN;
        const brightDataCollector = process.env.BRIGHTDATA_COLLECTOR_ID;
        let records;

        if (brightDataToken && brightDataCollector) {
          try {
            records = await runBrightDataCollector({
              apiToken: brightDataToken,
              collectorId: brightDataCollector,
              url: targetUrl,
              selector: usedSelector,
            });
            emit({
              type: "ok",
              message: `Bright Data Scraper Studio returned ${records.length} record(s).`,
              recordsFound: records.length,
              sessionState: "complete",
            });
          } catch (err) {
            emit({
              type: "err",
              message: `Bright Data extraction failed: ${err.message}. Falling back to local extraction.`,
            });
            records = await extractRecords(page, usedSelector);
            emit({
              type: "ok",
              message: `Local fallback: selector "${usedSelector}" matched ${records.length} record(s).`,
              recordsFound: records.length,
              sessionState: "complete",
            });
          }
        } else {
          emit({
            type: "warn",
            message:
              "BRIGHTDATA_API_TOKEN / BRIGHTDATA_COLLECTOR_ID not set in .env — using local extraction only.",
          });
          records = await extractRecords(page, usedSelector);
          emit({
            type: "ok",
            message: `Selector "${usedSelector}" matched ${records.length} record(s).`,
            recordsFound: records.length,
            sessionState: "complete",
          });
        }

        await browser.close();
        return { success: true, selector: usedSelector, records };
      }
      emit({
        type: "warn",
        message: `No candidate selector matched. Requesting a healed selector from ${llmProvider}.`,
        sessionState: "healing",
      });

      const snapshot = await buildPageSnapshot(page);
      const healed = await requestHealedSelector({
        provider: llmProvider,
        systemPrompt,
        failedSelector: selectorCandidates[0],
        snapshot,
        targetUrl,
      });

      emit({
        type: "heal",
        message: `Healed selector proposed: "${healed.selector}" — ${healed.reasoning || "no reasoning given"}`,
      });

      selectorCandidates = [healed.selector, ...selectorCandidates];
      await browser.close();
    } catch (err) {
      lastError = err;
      emit({ type: "err", message: `Attempt ${attempt + 1} failed: ${err.message}` });
      if (browser) await browser.close().catch(() => {});
    }

    attempt += 1;
  }

  emit({
    type: "err",
    message: lastError ? `Exhausted retries. Last error: ${lastError.message}` : "Exhausted retries without a match.",
    sessionState: "error",
  });
  return { success: false, error: lastError ? lastError.message : "No matching selector found." };
}

module.exports = { runScrapeJob };
