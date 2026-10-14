import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// --- The swap point ---------------------------------------------------------
// Every command talks to the bot through the functions exported at the bottom
// of this file. Nothing above this line leaks out. To move to Postgres later,
// rewrite the bodies below and leave every command file untouched.
//
// Storage engine: node:sqlite, built into Node 22+ — no native compile step,
// no dependency, which is why this replaced better-sqlite3.

const here = dirname(fileURLToPath(import.meta.url));

// Where the database file lives.
//
//   Locally        data/ next to the source, so nothing needs configuring.
//   On a host      DATA_DIR points at a mounted volume, so hangar entries
//                  survive a redeploy. Without a volume the container
//                  filesystem is replaced on every deploy and the data is lost.
const dataDir = process.env.DATA_DIR
  ? resolve(process.env.DATA_DIR)
  : resolve(here, "../../data");

mkdirSync(dataDir, { recursive: true });

const dbPath = resolve(dataDir, "org.sqlite");
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS hangar_ships (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id    TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    ship_name   TEXT NOT NULL,
    quantity    INTEGER NOT NULL DEFAULT 1,
    notes       TEXT,
    created_at  INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_hangar_guild_ship
    ON hangar_ships (guild_id, ship_name);

  CREATE INDEX IF NOT EXISTS idx_hangar_user
    ON hangar_ships (guild_id, user_id);
`);

// Logged once at startup so a deployment's logs show where the data landed —
// the first thing worth checking if hangar entries ever appear to reset.
console.log(`Database: ${dbPath}`);

const now = () => Date.now();

export function databasePath() {
  return dbPath;
}

// --- Hangar -----------------------------------------------------------------

export function addShip({ guildId, userId, shipName, quantity = 1, notes = null }) {
  const existing = db
    .prepare(
      `SELECT id, quantity FROM hangar_ships
        WHERE guild_id = ? AND user_id = ? AND lower(ship_name) = lower(?)`,
    )
    .get(guildId, userId, shipName);

  if (existing) {
    db.prepare(
      `UPDATE hangar_ships SET quantity = quantity + ?, notes = COALESCE(?, notes)
        WHERE id = ?`,
    ).run(quantity, notes, existing.id);
    return { updated: true, id: existing.id };
  }

  const result = db
    .prepare(
      `INSERT INTO hangar_ships
         (guild_id, user_id, ship_name, quantity, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(guildId, userId, shipName, quantity, notes, now());

  return { updated: false, id: Number(result.lastInsertRowid) };
}

export function removeShip({ guildId, userId, shipName }) {
  const row = db
    .prepare(
      `SELECT id, quantity FROM hangar_ships
        WHERE guild_id = ? AND user_id = ? AND lower(ship_name) = lower(?)`,
    )
    .get(guildId, userId, shipName);

  if (!row) return { found: false };

  if (row.quantity > 1) {
    db.prepare(`UPDATE hangar_ships SET quantity = quantity - 1 WHERE id = ?`).run(row.id);
    return { found: true, remaining: row.quantity - 1 };
  }

  db.prepare(`DELETE FROM hangar_ships WHERE id = ?`).run(row.id);
  return { found: true, remaining: 0 };
}

export function listShips({ guildId, userId }) {
  return db
    .prepare(
      `SELECT ship_name, quantity, notes FROM hangar_ships
        WHERE guild_id = ? AND user_id = ?
        ORDER BY ship_name COLLATE NOCASE`,
    )
    .all(guildId, userId);
}

// Who has this ship. Substring match so "carrack" finds "Anvil Carrack".
export function findShips({ guildId, shipName }) {
  return db
    .prepare(
      `SELECT user_id, ship_name, quantity, notes FROM hangar_ships
        WHERE guild_id = ? AND lower(ship_name) LIKE lower(?)
        ORDER BY ship_name COLLATE NOCASE, user_id`,
    )
    .all(guildId, `%${shipName}%`);
}

export function hangarTotals({ guildId }) {
  return db
    .prepare(
      `SELECT COUNT(DISTINCT user_id) AS pilots,
              COALESCE(SUM(quantity), 0) AS ships
         FROM hangar_ships WHERE guild_id = ?`,
    )
    .get(guildId);
}

// --- Whole-table reads, for backup and export -------------------------------

// Every row, across every server. Used by /backup, which produces a file an
// operator keeps off-platform — the one copy that survives losing the host.
export function exportAll() {
  return {
    hangarShips: db
      .prepare(
        `SELECT id, guild_id, user_id, ship_name, quantity, notes, created_at
           FROM hangar_ships ORDER BY guild_id, user_id, ship_name COLLATE NOCASE`,
      )
      .all(),
  };
}

// Rows for one server, shaped for a spreadsheet: flat, human-readable, one row
// per ship. Timestamps become ISO strings so a sheet can sort and filter them.
export function exportForGuild({ guildId }) {
  const rows = db
    .prepare(
      `SELECT user_id, ship_name, quantity, notes, created_at
         FROM hangar_ships
        WHERE guild_id = ?
        ORDER BY user_id, ship_name COLLATE NOCASE`,
    )
    .all(guildId);

  return rows.map((row) => ({
    userId: row.user_id,
    shipName: row.ship_name,
    quantity: row.quantity,
    notes: row.notes ?? "",
    addedAt: new Date(row.created_at).toISOString(),
  }));
}

export function closeDb() {
  try {
    db.close();
  } catch {
    // Already closed, or never opened — nothing to do.
  }
}

export default db;
