import {
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import { findCommodityPrices, findVehicle } from "../data/sc-api.js";

const ORG_COLOR = 0x2f6f9f;
const number = (value) => Number(value ?? 0).toLocaleString("en-GB");

export const data = new SlashCommandBuilder()
  .setName("calc")
  .setDescription("Work out what a trade run costs and returns")
  .addStringOption((option) =>
    option
      .setName("commodity")
      .setDescription("What you're hauling, e.g. Laranite")
      .setRequired(true)
      .setMaxLength(60),
  )
  .addIntegerOption((option) =>
    option
      .setName("scu")
      .setDescription("How much cargo space you'll fill")
      .setMinValue(1)
      .setMaxValue(5000)
      .setRequired(true),
  )
  .addIntegerOption((option) =>
    option
      .setName("budget")
      .setDescription("Credits available to spend (omit for no cap)")
      .setMinValue(1),
  )
  .addStringOption((option) =>
    option
      .setName("sell_at")
      .setDescription("Override the sale price with a specific aUEC/SCU figure")
      .setMaxLength(12),
  );

export async function execute(interaction) {
  const commodity = interaction.options.getString("commodity", true).trim();
  const scu = interaction.options.getInteger("scu", true);
  const budget = interaction.options.getInteger("budget");
  const sellOverrideRaw = interaction.options.getString("sell_at");

  await interaction.deferReply();

  let prices;
  try {
    prices = await findCommodityPrices(commodity, { limit: 5 });
  } catch (error) {
    console.error("Calculator lookup failed");
    console.error(error);
    await interaction.editReply(
      `**Price lookup failed.**\n\`\`\`\n${String(error?.message ?? error).slice(0, 500)}\n\`\`\``,
    );
    return;
  }

  if (!prices) {
    await interaction.editReply(
      `No commodity matching **${commodity}** found. Try a name like Laranite, Titanium or Quantanium.`,
    );
    return;
  }

  const buy = prices.bestBuy;
  const sell = prices.bestSell;

  if (!buy) {
    await interaction.editReply(
      `No terminal is currently selling **${prices.name}**, so there's nothing to buy.`,
    );
    return;
  }

  // A manual sale price wins over the market's best, so someone can model a
  // specific destination without needing a terminal the API happens to know.
  const sellOverride = sellOverrideRaw ? Number(sellOverrideRaw.replace(/[^\d.]/g, "")) : null;
  const salePrice = Number.isFinite(sellOverride) && sellOverride > 0
    ? sellOverride
    : sell?.price ?? null;

  if (!salePrice) {
    await interaction.editReply(
      `No terminal is currently buying **${prices.name}**. Provide a sell_at figure to model the run anyway.`,
    );
    return;
  }

  // Stock caps the load as well as the hold — no point buying what isn't there.
  const stock = Number(buy.stock) > 0 ? Number(buy.stock) : null;
  let units = scu;
  const notes = [];

  if (stock !== null && stock < scu) {
    units = stock;
    notes.push(
      `Capped at **${number(stock)} SCU** by reported stock at ${buy.terminal}.`,
    );
  }

  const costPerUnit = buy.price;
  let totalCost = units * costPerUnit;
  let affordableUnits = units;

  if (budget && totalCost > budget) {
    affordableUnits = Math.floor(budget / costPerUnit);
    notes.push(
      `Budget covers **${number(affordableUnits)} SCU** at ${number(costPerUnit)}/SCU — ` +
        `${number(units - affordableUnits)} SCU short of a full load.`,
    );
    units = affordableUnits;
    totalCost = units * costPerUnit;
  }

  if (units < 1) {
    await interaction.editReply(
      `Your budget of ${number(budget)} aUEC doesn't cover even 1 SCU of **${prices.name}** at ${number(costPerUnit)}/SCU.`,
    );
    return;
  }

  const revenue = units * salePrice;
  const profit = revenue - totalCost;
  const margin = salePrice - costPerUnit;

  const usedOverride = Number.isFinite(sellOverride) && sellOverride > 0;

  const embed = new EmbedBuilder()
    .setTitle(`Run plan — ${prices.name}`)
    .setColor(profit > 0 ? ORG_COLOR : 0xed4245)
    .setDescription(
      `**${number(units)} SCU** of **${prices.name}**` +
        (units < scu ? ` *(planned ${number(scu)} SCU)*` : "") +
        `\n\n**${number(profit)} aUEC profit** at ${number(margin)} aUEC/SCU margin.`,
    )
    .addFields(
      {
        name: "Buy",
        value: `${number(costPerUnit)} aUEC/SCU\n**${buy.terminal}**${buy.location ? `\n${buy.location}` : ""}`,
        inline: true,
      },
      {
        name: "Sell",
        value:
          `${number(salePrice)} aUEC/SCU\n` +
          (usedOverride
            ? "*manual price*"
            : `**${sell.terminal}**${sell.location ? `\n${sell.location}` : ""}`),
        inline: true,
      },
      { name: "\u200b", value: "\u200b", inline: true },
      { name: "Cargo cost", value: `${number(totalCost)} aUEC`, inline: true },
      { name: "Sale value", value: `${number(revenue)} aUEC`, inline: true },
      { name: "Profit", value: `**${number(profit)} aUEC**`, inline: true },
    );

  if (notes.length > 0) {
    embed.addFields({ name: "Adjustments", value: notes.join("\n") });
  }

  if (prices.isIllegal) {
    embed.addFields({
      name: "⚠️ Illegal commodity",
      value: "Expect scans, interdiction and fines. Route through lawless space.",
    });
  }

  const stamp = prices.updatedAt
    ? `<t:${Math.floor(new Date(prices.updatedAt).getTime() / 1000)}:R>`
    : "unknown";

  embed.setFooter({
    text: `Player-reported prices via UEX · last update ${stamp} · verify stock before you fly`,
  });

  await interaction.editReply({ embeds: [embed] });
}
