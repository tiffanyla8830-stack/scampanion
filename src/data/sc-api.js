// Shared helpers for talking to the Star Citizen community APIs.
//
// Data sources (both free, neither needs a key):
//   - Star Citizen Wiki API: ships, vehicles, items, locations
//   - UEX Corp:              commodity prices (crowdsourced — can be stale)
//
// Rate limits worth respecting: Wiki search is 60 req/min per IP; UEX allows
// 120 req/min. Both are far above what a Discord bot generates, but a small
// cache keeps repeat lookups instant and protects the upstream services.

const WIKI_BASE = "https://api.star-citizen.wiki/api";
const UEX_BASE = "https://api.uexcorp.uk/2.0";

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map();

function cached(key, produce) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  return produce().then((value) => {
    cache.set(key, { at: Date.now(), value });
    return value;
  });
}

async function getJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      // Identifies the bot politely to the community API maintainers.
      "User-Agent": "StarCitizenOrgCompanion/1.0 (Discord bot)",
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed with ${response.status} for ${url}`);
  }

  return response.json();
}

// --- Ships / vehicles -------------------------------------------------------

// Ship data is a fixed property of the hull — cargo capacity does not change
// between commands — so it is cached far longer than market prices. This also
// keeps /route well clear of the Wiki API's 60 requests/minute ceiling.
const SHIP_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function shipCached(key, produce) {
  const hit = cache.get(key);
  // Reuse the shared entry only while it is within the ship TTL.
  if (hit && Date.now() - hit.at < SHIP_CACHE_TTL_MS) return hit.value;

  return produce().then((value) => {
    cache.set(key, { at: Date.now(), value });
    return value;
  });
}

// Cleans a user-typed ship name into something safe to put in a query string.
// Quotes in particular cause a 422 from the Wiki API's /search endpoint, and
// Discord passes them through when someone types /route ship:"Cutlass Black".
export function cleanShipName(raw) {
  return String(raw ?? "")
    .replace(/["'`“”‘’]/g, "")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function findVehicle(rawName) {
  const name = cleanShipName(rawName);
  if (!name) return null;

  return shipCached(`vehicle:${name.toLowerCase()}`, async () => {
    // Primary lookup: the name filter, which is what works from a shell.
    try {
      const payload = await getJson(
        `${WIKI_BASE}/vehicles?filter[name]=${encodeURIComponent(name)}`,
      );
      const list = payload?.data ?? [];
      if (list.length > 0) return pickVehicle(list, name);
    } catch (error) {
      // A 422 or 5xx here should not kill the command outright; try search.
      console.error(`Vehicle name filter failed for "${name}"`);
      console.error(error);
    }

    // Fallback: free-text search, which also matches class names. Uses the
    // sanitised name — no quotes, nothing the endpoint can reject.
    const search = await getJson(
      `${WIKI_BASE}/search?filter[query]=${encodeURIComponent(name)}`,
    );
    const vehicle = (search?.data ?? []).find((entry) => entry.type === "vehicle");
    if (!vehicle) return null;

    // The index record is enough; avoid a second request that can fail.
    return vehicle;
  });
}

function pickVehicle(list, wanted) {
  const normalise = (value) => String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();

  // Exact name first — "Cutlass Black" should never resolve to
  // "Cutlass Black PYAM Exec", which is a different hull with its own stats.
  const exact = list.find((vehicle) => normalise(vehicle.name) === wanted);
  if (exact) return exact;

  // Then a game_name match, which is what the API often returns for a hull.
  const byGameName = list.find((vehicle) => normalise(vehicle.game_name) === wanted);
  if (byGameName) return byGameName;

  // Otherwise prefer a result that actually reports cargo over one that
  // does not — a detail stub would break /route downstream.
  const cargoBearing = list.find((vehicle) => Number(vehicle.cargo_capacity) > 0);

  return cargoBearing ?? list[0];
}

// --- Commodities (UEX) ------------------------------------------------------

// Builds the human-readable location chain for a price row, e.g.
// "Stanton · Crusader · Orison · Providence Surplus".
function describeTerminal(row) {
  const chain = [
    row.star_system_name,
    row.planet_name,
    row.moon_name,
    row.city_name,
    row.space_station_name,
    row.outpost_name,
  ].filter(Boolean);

  return {
    terminal: row.terminal_name ?? "Unknown terminal",
    location: chain.join(" · "),
    code: row.terminal_code ?? null,
  };
}

const rankBy = (key, direction) => (a, b) => {
  const left = Number(a[key]) || 0;
  const right = Number(b[key]) || 0;
  return direction === "desc" ? right - left : left - right;
};

async function resolveCommodity(commodityName) {
  const commodities = await getJson(`${UEX_BASE}/commodities`);
  const list = commodities?.data ?? [];

  return (
    list.find((item) => item.name?.toLowerCase() === commodityName.toLowerCase()) ??
    list.find((item) => item.code?.toLowerCase() === commodityName.toLowerCase()) ??
    list.find((item) => item.name?.toLowerCase().includes(commodityName.toLowerCase())) ??
    null
  );
}

function summarisePrices(rows, limit) {
  // A row can carry a buy price, a sell price, or both — the two directions
  // are separate lists because a terminal rarely does both for one commodity.
  //
  //   price_sell = what you pay when the terminal SELLS to you  (you buy)
  //   price_buy  = what the terminal PAYS when you sell to it   (you sell)
  const youBuy = rows
    .filter((row) => Number(row.price_sell) > 0)
    .sort(rankBy("price_sell", "asc"));

  const youSell = rows
    .filter((row) => Number(row.price_buy) > 0)
    .sort(rankBy("price_buy", "desc"));

  const modified = rows
    .map((row) => Number(row.date_modified) || 0)
    .sort((a, b) => b - a)[0];

  return {
    cheapest: youBuy.slice(0, limit).map((row) => ({
      ...describeTerminal(row),
      price: Number(row.price_sell),
      stock: row.scu_sell,
    })),
    mostProfitable: youSell.slice(0, limit).map((row) => ({
      ...describeTerminal(row),
      price: Number(row.price_buy),
      stock: row.scu_buy,
    })),
    bestBuy: youBuy[0]
      ? { ...describeTerminal(youBuy[0]), price: Number(youBuy[0].price_sell) }
      : null,
    bestSell: youSell[0]
      ? { ...describeTerminal(youSell[0]), price: Number(youSell[0].price_buy) }
      : null,
    buyCount: youBuy.length,
    sellCount: youSell.length,
    updatedAt: modified ? new Date(modified * 1000).toISOString() : null,
  };
}

export async function findCommodityPrices(commodityName, { limit = 10 } = {}) {
  return cached(`commodity:${commodityName.toLowerCase()}`, async () => {
    const match = await resolveCommodity(commodityName);
    if (!match) return null;

    const prices = await getJson(
      `${UEX_BASE}/commodities_prices?commodity_name=${encodeURIComponent(match.name)}`,
    );
    const summary = summarisePrices(prices?.data ?? [], limit);

    return {
      name: match.name,
      code: match.code,
      isIllegal: match.is_illegal === 1,
      margin:
        summary.bestBuy && summary.bestSell
          ? summary.bestSell.price - summary.bestBuy.price
          : null,
      ...summary,
    };
  });
}

// --- Terminal lookup (/terminal) --------------------------------------------
//
// UEX accepts terminal_name as a query parameter, so everything a single
// location stocks or buys comes back in one request. Matching is done on the
// full terminal name; a partial match is resolved first via /terminals so
// "/terminal orinth" works without knowing the exact string.

export async function findTerminal(query) {
  return cached(`terminal:${query.toLowerCase()}`, async () => {
    const terminals = await getJson(`${UEX_BASE}/terminals`);
    const list = terminals?.data ?? [];

    const wanted = query.trim().toLowerCase();

    const exact = list.find((t) => (t.name ?? "").toLowerCase() === wanted);
    const partial = list.find((t) => (t.name ?? "").toLowerCase().includes(wanted));
    const match = exact ?? partial;

    if (!match) return null;

    const prices = await getJson(
      `${UEX_BASE}/commodities_prices?terminal_name=${encodeURIComponent(match.name)}`,
    );
    const rows = prices?.data ?? [];

    if (rows.length === 0) {
      return {
        name: match.name,
        code: match.code ?? null,
        location: [match.star_system_name, match.planet_name, match.city_name, match.space_station_name, match.outpost_name]
          .filter(Boolean)
          .join(" · "),
        sells: [],
        buys: [],
        updatedAt: null,
      };
    }

    const describe = (row) => ({
      commodity: row.commodity_name ?? "Unknown",
      code: row.commodity_code ?? null,
      price: Number(row.price_sell) || 0,
      payout: Number(row.price_buy) || 0,
      stock: row.scu_sell ?? null,
      demand: row.scu_buy ?? null,
      // For a terminal-side view: does it sell to us, buy from us, or both?
      sellsToUs: Number(row.price_sell) > 0,
      buysFromUs: Number(row.price_buy) > 0,
    });

    const all = rows.map(describe);

    const sells = all
      .filter((row) => row.sellsToUs)
      .sort((a, b) => a.price - b.price);

    const buys = all
      .filter((row) => row.buysFromUs)
      .sort((a, b) => b.payout - a.payout);

    const modified = rows
      .map((row) => Number(row.date_modified) || 0)
      .sort((a, b) => b - a)[0];

    return {
      name: match.name,
      code: match.code ?? null,
      location: [match.star_system_name, match.planet_name, match.city_name, match.space_station_name, match.outpost_name]
        .filter(Boolean)
        .join(" · "),
      sells,
      buys,
      updatedAt: modified ? new Date(modified * 1000).toISOString() : null,
    };
  });
}

// Used by /route.
//
// The obvious approach — one call to /commodities_prices_all — returns the
// entire price table for the game and proved unreliable: it is a very large
// response, cached 30 minutes upstream, and matching its rows back to
// commodity ids yielded nothing. So instead we shortlist commodities from the
// cheap /commodities list and ask for prices one commodity at a time, which is
// the same endpoint /commodity uses and is known to work. Requests go out in
// parallel, in small waves, to stay well inside UEX's 120/min limit.
const ROUTE_BATCH_SIZE = 6;

async function pricesForCommodity(commodity) {
  try {
    const prices = await getJson(
      `${UEX_BASE}/commodities_prices?commodity_name=${encodeURIComponent(commodity.name)}`,
    );
    const summary = summarisePrices(prices?.data ?? [], 1);

    if (!summary.bestBuy || !summary.bestSell) return null;

    return {
      name: commodity.name,
      code: commodity.code,
      isIllegal: commodity.is_illegal === 1,
      cheapest: summary.bestBuy,
      bestSell: summary.bestSell,
    };
  } catch (error) {
    // One bad commodity should not sink the whole command.
    console.error(`Price lookup failed for ${commodity.name}`);
    console.error(error);
    return null;
  }
}

// Ordered so the most commonly traded commodities are checked first — the
// shortlist is capped, so order determines what gets looked at.
const HIGH_VOLUME_FIRST = [
  "Laranite",
  "Titanium",
  "Gold",
  "Quantanium",
  "Agricium",
  "Bexalite",
  "Taranite",
  "Borase",
  "Diamond",
  "Hephaestanite",
  "Processed Food",
  "Medical Supplies",
  "Hydrogen",
  "Iodine",
  "Copper",
  "Aluminium",
  "Corundum",
  "Beryl",
  "Astatine",
  "Distilled Spirits",
  "Astro Pasta",
  "Blue Bilva",
  "Fresh Food",
  "Waste",
  "Scrap",
];

export async function tradeRouteCandidates({ legalOnly = true, limit = 24 } = {}) {
  return cached(`routes:${legalOnly}:${limit}`, async () => {
    const commodities = await getJson(`${UEX_BASE}/commodities`);
    const all = commodities?.data ?? [];

    // Note: we deliberately do NOT filter on the list endpoint's is_buy /
    // is_sell flags. They are not reliably present on every commodity record,
    // and filtering on them excluded everything. Tradeability is instead
    // established by whether the price lookup actually returns both ends of a
    // run — which is the data that matters anyway.
    const byName = new Map(
      all.map((item) => [String(item.name).toLowerCase(), item]),
    );

    let shortlist = [];
    for (const name of HIGH_VOLUME_FIRST) {
      const match = byName.get(name.toLowerCase());
      if (match) shortlist.push(match);
    }

    // If the known-good names are absent (a wipe, a renamed commodity), fall
    // back to the API's own list rather than returning nothing.
    if (shortlist.length === 0) {
      shortlist = all.slice(0, limit);
    }

    if (legalOnly) {
      shortlist = shortlist.filter((item) => item.is_illegal !== 1);
    }

    shortlist = shortlist.slice(0, limit);

    if (shortlist.length === 0) return [];

    const candidates = [];
    for (let index = 0; index < shortlist.length; index += ROUTE_BATCH_SIZE) {
      const wave = shortlist.slice(index, index + ROUTE_BATCH_SIZE);
      const results = await Promise.all(wave.map(pricesForCommodity));

      for (const result of results) {
        if (result) candidates.push(result);
      }
    }

    return candidates;
  });
}

// --- Live platform status ---------------------------------------------------

export async function fetchRsiStatus() {
  return cached("rsi:status", async () => {
    // statuspage-style public feed, no key required.
    const summary = await getJson("https://status.robertsspaceindustries.com/index.json");
    const components = summary?.components ?? [];

    return {
      updatedAt: summary?.page?.updated_at ?? null,
      status: summary?.status?.description ?? "Unknown",
      indicator: summary?.status?.indicator ?? "none",
      components: components.map((component) => ({
        name: component.name,
        status: component.status,
      })),
      incidents: (summary?.incidents ?? []).map((incident) => ({
        name: incident.name,
        status: incident.status,
        impact: incident.impact,
      })),
    };
  });
}
