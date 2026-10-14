import {
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import { findTerminal } from "../data/sc-api.js";

const ORG_COLOR = 0x2f6f9f;

// Discord caps a single embed field at 1024 characters and an embed at 25
// fields. A busy trade hub can stock 40+ commodities, so each list is trimmed
// to fit rather than being allowed to blow the limit.
const FIELD_LIMIT = 1024;

const number = (value) =>
  value === null || value === undefined || value === ""
    ? "—"
    : Number(value).toLocaleString("en-GB");

function renderGoods(rows, direction) {
  const lines = rows.map((row) => {
    if (direction === "sells") {
      const stock = row.stock ? ` · ${number(row.stock)} SCU` : "";
      return `• **${row.commodity}** — ${number(row.price)} aUEC/SCU${stock}`;
    }
    const demand = row.demand ? ` · wants ${number(row.demand)} SCU` : "";
    return `• **${row.commodity}** — ${number(row.payout)} aUEC/SCU${demand}`;
  });

  const kept = [];
  for (const line of lines) {
    const candidate = [...kept, line].join("\n");
    if (candidate.length + 40 > FIELD_LIMIT) break;
    kept.push(line);
  }

  let out = kept.join("\n");
  if (kept.length < lines.length) {
    out += `\n*…and ${lines.length - kept.length} more*`;
  }
  return out;
}

export const data = new SlashCommandBuilder()
  .setName("terminal")
  .setDescription("What a location buys and sells")
  .addStringOption((option) =>
    option
      .setName("name")
      .setDescription("Terminal or shop name, e.g. Orinth, TDD Area 18, CRU-L5")
      .setRequired(true)
      .setMaxLength(80),
  );

export async function execute(interaction) {
  const query = interaction.options.getString("name", true).trim();

  await interaction.deferReply();

  let terminal;
  try {
    terminal = await findTerminal(query);
  } catch (error) {
    console.error("Terminal lookup failed");
    console.error(error);
    await interaction.editReply(
      `**Terminal lookup failed.**\n\`\`\`\n${String(error?.message ?? error).slice(0, 500)}\n\`\`\``,
    );
    return;
  }

  if (!terminal) {
    await interaction.editReply(
      `No terminal or shop matching **${query}** found.\n` +
        "*Try part of the name — `Orinth`, `TDD`, `Area 18`, `CRU-L5`.*",
    );
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(terminal.name)
    .setColor(ORG_COLOR);

  const subtitle = [
    terminal.location,
    `${terminal.sells.length} sold · ${terminal.buys.length} bought`,
  ]
    .filter(Boolean)
    .join("\n");

  embed.setDescription(subtitle);

  if (terminal.sells.length > 0) {
    const cheapest = terminal.sells[0];
    embed.addFields({
      name: `🛒 For sale here — ${terminal.sells.length} commodit${terminal.sells.length === 1 ? "y" : "ies"}`,
      value:
        `*You buy from this terminal.* Cheapest: **${cheapest.commodity}** at ${number(cheapest.price)} aUEC/SCU\n` +
        renderGoods(terminal.sells, "sells"),
    });
  } else {
    embed.addFields({
      name: "🛒 For sale here",
      value: "This terminal currently sells nothing.",
    });
  }

  if (terminal.buys.length > 0) {
    const best = terminal.buys[0];
    embed.addFields({
      name: `💰 Bought here — ${terminal.buys.length} commodit${terminal.buys.length === 1 ? "y" : "ies"}`,
      value:
        `*You sell to this terminal.* Best payer: **${best.commodity}** at ${number(best.payout)} aUEC/SCU\n` +
        renderGoods(terminal.buys, "buys"),
    });
  } else {
    embed.addFields({
      name: "💰 Bought here",
      value: "This terminal currently buys nothing.",
    });
  }

  const stamp = terminal.updatedAt
    ? `<t:${Math.floor(new Date(terminal.updatedAt).getTime() / 1000)}:R>`
    : "unknown";

  embed.setFooter({
    text: `Prices per SCU, player-reported via UEX · last update ${stamp}`,
  });

  await interaction.editReply({ embeds: [embed] });
}
