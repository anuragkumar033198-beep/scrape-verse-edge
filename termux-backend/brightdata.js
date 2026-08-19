"use strict";

/* ===========================================================
   Bright Data Scraper Studio client
   -----------------------------------------------------------
   Wraps the two-call Data Collection API:
     1. POST /dca/trigger?collector=<id>  — queue an input batch,
        returns a collection_id (== snapshot_id).
     2. GET  /dca/dataset?id=<snapshot_id> — poll until the
        snapshot is ready, then returns the structured records.

   Source: https://docs.brightdata.com/datasets/scraper-studio/quickstart

   IMPORTANT: this assumes your published collector was built in
   Scraper Studio's IDE to accept { url, selector } as its input
   row shape, and to use that selector to extract records. Verify
   the exact input/output shape against your own collector's
   "Test" panel in Scraper Studio before a live demo — custom
   collectors can be configured differently depending on how you
   built them.
   =========================================================== */

const BRIGHTDATA_BASE = "https://api.brightdata.com";
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 60000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function triggerCollector({ apiToken, collectorId, inputs }) {
  const res = await fetch(
    `${BRIGHTDATA_BASE}/dca/trigger?collector=${encodeURIComponent(collectorId)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(inputs),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Bright Data trigger failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  const snapshotId = data.collection_id || data.snapshot_id;
  if (!snapshotId) {
    throw new Error("Bright Data trigger response missing collection_id/snapshot_id.");
  }
  return snapshotId;
}

async function pollForResult({ apiToken, snapshotId }) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const res = await fetch(
      `${BRIGHTDATA_BASE}/dca/dataset?id=${encodeURIComponent(snapshotId)}`,
      { headers: { Authorization: `Bearer ${apiToken}` } }
    );

    if (res.status === 202) {
      // Snapshot not ready yet — wait and poll again.
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Bright Data dataset fetch failed (${res.status}): ${text}`);
    }

const rawText = await res.text();
let data;

try {
  // Try standard JSON first
  data = JSON.parse(rawText);
} catch (e) {
  // Fallback to NDJSON (Newline Delimited JSON)
  data = rawText.trim().split('\n').map(line => JSON.parse(line));
}

return Array.isArray(data) ? data.flat() : [data];
  }

  throw new Error(
    `Timed out waiting for Bright Data snapshot ${snapshotId} after ${POLL_TIMEOUT_MS}ms.`
  );
}

/**
 * Triggers the published collector for a single { url, selector }
 * input and returns the structured records once the snapshot is ready.
 */
async function runCollector({ apiToken, collectorId, url, selector }) {
  const snapshotId = await triggerCollector({
    apiToken,
    collectorId,
    inputs: [{ url, selector }],
  });
  return await pollForResult({ apiToken, snapshotId });
}

module.exports = { runCollector };
