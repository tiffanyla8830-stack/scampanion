import { exportForGuild } from "./data/store.js";

// Pushes the server's hangar roster into a Google Sheet.
//
// This runs on the bot's host, so it cannot use the Discord-side connector —
// it talks to the Sheets API directly with a service account. Setup is
// documented in HOSTING-sheets.md; without the three env vars below the
// feature reports itself as not configured rather than failing obscurely.

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

const HEADERS = ["User ID", "Ship", "Quantity", "Notes", "Added At"];

export function sheetsConfigured() {
  return Boolean(
    process.env.GOOGLE_SHEET_ID &&
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
      process.env.GOOGLE_PRIVATE_KEY,
  );
}

// Mints an OAuth2 access token from the service account's private key.
// Node's crypto signs the JWT; no googleapis dependency needed for one call.
async function getAccessToken() {
  const { createSign } = await import("node:crypto");

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  // Hosts usually store the key with literal \n sequences; restore real ones.
  const key = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n");

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const b64 = (obj) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");

  const unsigned = `${b64(header)}.${b64(claims)}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(key, "base64url");
  const assertion = `${unsigned}.${signature}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Google auth failed (${response.status}): ${detail.slice(0, 300)}`);
  }

  const payload = await response.json();
  return payload.access_token;
}

async function sheetsFetch(path, { method = "GET", body, token } = {}) {
  const response = await fetch(`${SHEETS_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Sheets API ${response.status}: ${detail.slice(0, 300)}`);
  }

  return response.json();
}

/**
 * Replaces the "Hangar" tab's contents with the current roster.
 *
 * A full replace rather than an append: the sheet is a live mirror of the
 * database, so removed ships should disappear from it. Appending would leave
 * ghosts behind.
 */
export async function syncHangarToSheet({ guildId, sheetName = "Hangar" }) {
  if (!sheetsConfigured()) {
    return { ok: false, reason: "not_configured" };
  }

  const rows = exportForGuild({ guildId });
  const token = await getAccessToken();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  const values = [
    HEADERS,
    ...rows.map((row) => [
      row.userId,
      row.shipName,
      row.quantity,
      row.notes,
      row.addedAt,
    ]),
  ];

  // Clear first so an emptied hangar doesn't leave stale rows behind.
  await sheetsFetch(
    `/${spreadsheetId}/values/${encodeURIComponent(`${sheetName}!A1:E100000`)}:clear`,
    { method: "POST", body: {}, token },
  ).catch(() => {
    // A clear on an empty or missing range is not an error worth surfacing.
  });

  await sheetsFetch(
    `/${spreadsheetId}/values/${encodeURIComponent(`${sheetName}!A1`)}?valueInputOption=RAW`,
    { method: "PUT", body: { range: `${sheetName}!A1`, majorDimension: "ROWS", values }, token },
  );

  return {
    ok: true,
    rowCount: rows.length,
    pilots: new Set(rows.map((row) => row.userId)).size,
    spreadsheetId,
  };
}
