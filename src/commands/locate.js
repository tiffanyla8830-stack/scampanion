import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";

const WIKI_BASE = "https://api.star-citizen.wiki/api";
const ORG_COLOR = 0x2f6f9f;

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
      "User-Agent": "StarCitizenOrgCompanion/1.0 (Discord bot)",
    },
  });
  if (!response.ok) throw new Error(`Request failed with ${response.status}`);
  return response.json();
}

// Look an item up by name, preferring ship components and gear over the
// cargo boxes and commodity pallets that share names with them.
async function findItem(name) {
  return cached(`item:${name.toLowerCase()}`, async () => {
    const url = `${WIKI_BASE}/items?filter[name]=${encodeURIComponent(name)}&page[size]=50`;
    const payload = await getJson(url);
    const list = payload?.data ?? [];
    if (list.length === 0) return null;

    const exact = list.filter((item) => item.name?.toLowerCase() === name.toLowerCase());

    // Prefer anything that is not a bulk cargo container, since a search for
    // "Titanium" should not return a 32 SCU pallet.
    const useful = (exact.length > 0 ? exact : list).filter(
      (item) => item.type !== "Cargo",
    );

    const pool = useful.length > 0 ? useful : exact.length > 0 ? exact : list;

    // A single unambiguous hit is the happy path.
    if (pool.length === 1) return pool[0];

    // Several sizes of the same part (S1/S2/S3): return them all so the command
    // can show a size table instead of arbitrarily picking one.
    return { multiple: pool.slice(0, 8) };
  });
}

async function findItemDetail(item) {
  return cached(`item-detail:${item.uuid}`, async () =>
    getJson(`${WIKI_BASE}/items/${item.uuid}`),
  );
}

function shopRows(shops) {
  // Each shop entry carries the shop name and its location ancestry.
  return shops
    .map((shop) => {
      const terminal = shop.name ?? shop.display_name ?? "Unknown shop";
      const location = [shop.location_name, shop.planet_name, shop.star_system_name]
        .filter(Boolean)
        .join(" · ");
      const price = shop.price_buy ?? shop.price ?? null;
      const priceText = price ? ` — ${Number(price).toLocaleString("en-GB")} aUEC` : "";
      return location ? `• **${terminal}**${priceText}\n  ${location}` : `• **${terminal}**${priceText}`;
    })
    .join("\n");
}

export const data = new SlashCommandBuilder()
  .setName("locate")
  .setDescription("Find where to buy a ship component, weapon or piece of gear")
  .addStringOption((option) =>
    option
      .setName("item")
      .setDescription("Item name, e.g. Atlas, Attrition-3, Novikov")
      .setRequired(true)
      .setMaxLength(80),
  );

export async function execute(interaction) {
  const query = interaction.options.getString("item", true).trim();

  await interaction.deferReply();

  let result;
  try {
    result = await findItem(query);
  } catch (error) {
    console.error("Item lookup failed");
    console.error(error);
    await interaction.editReply(
      "The Star Citizen Wiki API didn't answer. Try again in a moment.",
    );
    return;
  }

  if (!result) {
    await interaction.editReply(`No item matching **${query}** found.`);
    return;
  }

  // Several sizes of the same part — show a compact table instead of guessing.
  if (result.multiple) {
    const lines = result.multiple.map((item) => {
      const size = item.size ? `S${item.size}` : "—";
      const kind = item.type_label ?? item.type ?? "Item";
      const maker = item.manufacturer?.name ?? "Unknown";
      return `• **${item.name}** — ${kind}, ${size}, ${maker}`;
    });

    const embed = new EmbedBuilder()
      .setTitle(`Matches for "${query}"`)
      .setDescription(
        `${lines.join("\n")}\n\nRun \`/locate\` again with the exact name to see where it's sold.`,
      )
      .setColor(ORG_COLOR)
      .setFooter({ text: "Data: Star Citizen Wiki API" });

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // Single hit — load the detail record, which is where shop data lives.
  let item = result;
  try {
    const detail = await findItemDetail(result);
    if (detail?.data) item = { ...result, ...detail.data };
  } catch {
    // Detail fetch failed; the index record is enough to show basics.
  }

  const shops = item.shops ?? [];
  const uexPurchase = item.uex_prices?.purchase ?? [];

  const embed = new EmbedBuilder()
    .setTitle(item.name ?? query)
    .setColor(ORG_COLOR)
    .addFields(
      {
        name: "Type",
        value: item.type_label ?? item.classification_label ?? item.type ?? "Unknown",
        inline: true,
      },
      { name: "Size", value: item.size ? `S${item.size}` : "—", inline: true },
      { name: "Grade", value: item.grade ?? "—", inline: true },
      {
        name: "Manufacturer",
        value: item.manufacturer?.name ?? "Unknown",
        inline: true,
      },
    );

  if (item.class && item.class !== item.type_label) {
    embed.addFields({ name: "Class", value: item.class, inline: true });
  }

  if (shops.length > 0) {
    embed.addFields({ name: `Sold at ${shops.length} shop(s)`, value: shopRows(shops) });
  } else if (uexPurchase.length > 0) {
    const rows = uexPurchase
      .slice(0, 12)
      .map((entry) => {
        const price = entry.price_buy
          ? ` — ${Number(entry.price_buy).toLocaleString("en-GB")} aUEC`
          : "";
        return `• ${entry.terminal_name ?? entry.shop_name ?? "Unknown"}${price}`;
      })
      .join("\n");
    embed.addFields({ name: "Where to buy (UEX reports)", value: rows });
  } else {
    embed.addFields({
      name: "Availability",
      value:
        "No shop data reported. It may only be obtainable by crafting, as a reward, or from a loot box.",
    });
  }

  const url = item.web_url ?? (item.slug ? `https://starcitizen.tools/items/${item.slug}` : null);
  if (url) embed.setURL(url);

  embed.setFooter({ text: "Data: Star Citizen Wiki API · community-maintained" });

  await interaction.editReply({ embeds: [embed] });
}

export const HELP_HINT = MessageFlags.Ephemeral;
