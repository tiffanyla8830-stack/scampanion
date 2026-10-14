import {
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import { findVehicle, tradeRouteCandidates } from "../data/sc-api.js";

const ORG_COLOR = 0x2f6f9f;

// A route needs at least this margin per SCU to be worth listing at all.
// Below it, fuel and time eat the profit.
const MIN_MARGIN = 1;

export const data = new SlashCommandBuilder()
  .setName("route")
  .setDescription("Rank trade runs that fit your ship's cargo hold")
  .addStringOption((option) =>
    option
      .setName("ship")
      .setDescription("The ship you'll fly, e.g. Cutlass Black")
      .setRequired(true)
      .setMaxLength(80),
  )
  .addIntegerOption((option) =>
    option
      .setName("budget")
      .setDescription("aUEC you can spend on cargo (omit for hold-limited)")
      .setMinValue(1),
  )
  .addBooleanOption((option) =>
    option
      .setName("legal_only")
      .setDescription("Exclude illegal commodities (default: yes)")
      .setRequired(false),
  )
  .addIntegerOption((option) =>
    option
      .setName("results")
      .setDescription("How many routes to show (default 5, max 10)")
      .setMinValue(1)
      .setMaxValue(10),
  );

function scuFromCapacity(cargoCapacity) {
  // Wiki reports cargo_capacity in SCU; a few hulls report null.
  return Number(cargoCapacity) || 0;
}

export async function execute(interaction) {
  const shipName = interaction.options.getString("ship", true).trim();
  const budget = interaction.options.getInteger("budget");
  const legalOnly = interaction.options.getBoolean("legal_only") ?? true;
  const limit = interaction.options.getInteger("results") ?? 5;

  await interaction.deferReply();

  let ship;
  try {
    ship = await findVehicle(shipName);
  } catch (error) {
    console.error("Ship lookup failed for /route");
    console.error(error);
    // Surface the real reason. The friendly message alone kept us guessing.
    await interaction.editReply(
      `**Ship lookup failed.**\n\`\`\`\n${String(error?.message ?? error).slice(0, 500)}\n\`\`\``,
    );
    return;
  }

  if (!ship) {
    await interaction.editReply(`No ship matching **${shipName}** found.`);
    return;
  }

  const capacity = scuFromCapacity(ship.cargo_capacity);
  if (capacity <= 0) {
    await interaction.editReply(
      `**${ship.name}** reports no cargo capacity, so it can't run trade routes.` +
        (ship.role ? ` It's a ${ship.role.toLowerCase()}.` : ""),
    );
    return;
  }

  let candidates;
  try {
    candidates = await tradeRouteCandidates({ legalOnly });
  } catch (error) {
    console.error("Route lookup failed");
    console.error(error);
    await interaction.editReply(
      `**Trade data lookup failed.**\n\`\`\`\n${String(error?.message ?? error).slice(0, 500)}\n\`\`\``,
    );
    return;
  }

  if (candidates.length === 0) {
    await interaction.editReply(
      "No trade data available right now.\n" +
        "*The commodity list or its prices came back empty — the API layer will need a closer look.*",
    );
    return;
  }

  // For each commodity, work out what one trip actually yields in this ship:
  // how much can be loaded (hold vs what the terminal has), what it costs,
  // and what the other end pays.
  const runs = [];

  for (const candidate of candidates) {
    const buy = candidate.cheapest;
    const sell = candidate.bestSell;
    if (!buy || !sell) continue;

    const margin = sell.price - buy.price;
    if (margin < MIN_MARGIN) continue;

    // Stock caps the load, as does the hold, as does the budget.
    const stockCap = Number(buy.stock) > 0 ? Number(buy.stock) : capacity;
    let units = Math.min(capacity, stockCap);

    if (budget) {
      const affordable = Math.floor(budget / buy.price);
      if (affordable < units) units = affordable;
    }

    if (units < 1) continue;

    runs.push({
      commodity: candidate.name,
      code: candidate.code,
      illegal: candidate.isIllegal,
      units,
      margin,
      cost: units * buy.price,
      revenue: units * sell.price,
      profit: units * margin,
      buyAt: buy,
      sellAt: sell,
    });
  }

  if (runs.length === 0) {
    await interaction.editReply(
      "No profitable routes found for those settings. Try a larger budget, or set `legal_only` to false.",
    );
    return;
  }

  // Rank by profit per trip for this specific ship, not by margin per SCU.
  runs.sort((a, b) => b.profit - a.profit);

  const shown = runs.slice(0, limit);

  // Discord caps a single embed field at 1024 characters, and a route entry
  // with its location chain runs to roughly 350. So each route gets its own
  // field rather than one long block — an embed allows up to 25 of them, which
  // is comfortably more than the 10-route ceiling here.
  const best = shown[0];

  const routeField = (run, index) => {
    const illegals = run.illegal ? " ⚠️ illegal" : "";
    const buyLoc = run.buyAt.location ? `\n${run.buyAt.location}` : "";
    const sellLoc = run.sellAt.location ? `\n${run.sellAt.location}` : "";

    let value = [
      `Load **${run.units.toLocaleString("en-GB")} SCU** · margin ${run.margin.toLocaleString("en-GB")}/SCU`,
      `Buy **${run.buyAt.terminal}** (${run.buyAt.price.toLocaleString("en-GB")}/SCU)${buyLoc}`,
      `Sell **${run.sellAt.terminal}** (${run.sellAt.price.toLocaleString("en-GB")}/SCU)${sellLoc}`,
      `Cost ${run.cost.toLocaleString("en-GB")} → return ${run.revenue.toLocaleString("en-GB")} aUEC`,
    ].join("\n");

    if (value.length > 1024) value = `${value.slice(0, 1015)}…`;

    return {
      name: `${index + 1}. ${run.commodity}${illegals} — ${run.profit.toLocaleString("en-GB")} aUEC`,
      value,
    };
  };

  const embed = new EmbedBuilder()
    .setTitle(`Trade routes for the ${ship.name}`)
    .setDescription(
      `${capacity.toLocaleString("en-GB")} SCU hold` +
        (budget ? ` · ${budget.toLocaleString("en-GB")} aUEC budget` : " · no budget cap") +
        (legalOnly ? " · legal goods only" : " · contraband included") +
        `\n\n**Best this trip: ${best.profit.toLocaleString("en-GB")} aUEC** on ${best.commodity}.`,
    )
    .setColor(ORG_COLOR)
    .addFields(shown.map(routeField))
    .setFooter({
      text: "Prices are player-reported via UEX and update hourly — verify stock before you fly.",
    });

  const shipUrl = ship.web_url ?? (ship.slug ? `https://starcitizen.tools/${ship.slug}` : null);
  if (shipUrl) embed.setURL(shipUrl);

  await interaction.editReply({ embeds: [embed] });
}
