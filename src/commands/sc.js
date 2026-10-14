import {
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import { fetchRsiStatus, findCommodityPrices, findVehicle } from "../data/sc-api.js";

const ORG_COLOR = 0x2f6f9f;

const number = (value) => (value === null || value === undefined ? "—" : value.toLocaleString("en-GB"));

// Discord caps a field value at 1024 characters, so long terminal lists are
// trimmed with a count instead of silently failing the whole embed.
const FIELD_LIMIT = 1024;

function renderList(rows, heading) {
  const lines = rows.map((row, index) => {
    const location = row.location ? `\n   ${row.location}` : "";
    const stock = row.stock ? ` · ${Number(row.stock).toLocaleString("en-GB")} SCU` : "";
    return `**${index + 1}.** ${row.terminal} — ${number(row.price)} aUEC/SCU${stock}${location}`;
  });

  let out = `${heading}\n${lines.join("\n")}`;
  if (out.length <= FIELD_LIMIT) return out;

  // Drop trailing entries until it fits, then say how many were left out.
  const kept = [];
  for (const line of lines) {
    const candidate = `${heading}\n${[...kept, line].join("\n")}`;
    if (candidate.length + 40 > FIELD_LIMIT) break;
    kept.push(line);
  }

  return `${heading}\n${kept.join("\n")}\n*…and ${lines.length - kept.length} more*`;
}

export const data = new SlashCommandBuilder()
  .setName("ship")
  .setDescription("Look up live ship data from the Star Citizen Wiki")
  .addStringOption((option) =>
    option
      .setName("name")
      .setDescription("Ship name, e.g. Carrack")
      .setRequired(true)
      .setMaxLength(80),
  );

export async function execute(interaction) {
  const name = interaction.options.getString("name", true).trim();

  await interaction.deferReply();

  let vehicle;
  try {
    vehicle = await findVehicle(name);
  } catch (error) {
    console.error("Ship lookup failed");
    console.error(error);
    await interaction.editReply(
      "The Star Citizen Wiki API didn't answer. Try again in a moment — it may be rate-limiting.",
    );
    return;
  }

  if (!vehicle) {
    await interaction.editReply(`No ship or vehicle matching **${name}** found.`);
    return;
  }

  const manufacturer = vehicle.manufacturer?.name ?? vehicle.manufacturer ?? "Unknown";
  const sizes = vehicle.sizes ?? vehicle.dimension ?? {};

  const embed = new EmbedBuilder()
    .setTitle(vehicle.name ?? name)
    .setDescription(
      [manufacturer, vehicle.career, vehicle.role].filter(Boolean).join(" · "),
    )
    .setColor(ORG_COLOR)
    .addFields(
      { name: "Crew", value: number(vehicle.crew?.max ?? vehicle.crew), inline: true },
      { name: "Cargo", value: `${number(vehicle.cargo_capacity)} SCU`, inline: true },
      { name: "Mass", value: `${number(vehicle.mass_total)} kg`, inline: true },
    );

  const length = sizes.length;
  const beam = sizes.beam ?? sizes.width;
  const height = sizes.height;
  if (length || beam || height) {
    embed.addFields({
      name: "Dimensions",
      value: `${length ?? "—"} × ${beam ?? "—"} × ${height ?? "—"} m`,
      inline: true,
    });
  }

  if (vehicle.speed) {
    embed.addFields({
      name: "Speed",
      value: `SCM ${number(vehicle.speed.scm)} · Max ${number(vehicle.speed.max)}`,
      inline: true,
    });
  }

  const pledge = (vehicle.pledge_price ?? vehicle.prices ?? []).find?.(
    (entry) => entry.source === "pledge_store" && entry.price,
  );
  if (pledge?.price) {
    embed.addFields({ name: "Pledge", value: `$${number(pledge.price)}`, inline: true });
  }

  const description = vehicle.game_description?.en_EN;
  if (description) {
    embed.addFields({
      name: "About",
      value: description.length > 500 ? `${description.slice(0, 497)}...` : description,
    });
  }

  embed.setFooter({ text: "Data: Star Citizen Wiki API · community-maintained" });

  const url = vehicle.web_url ?? (vehicle.slug ? `https://starcitizen.tools/${vehicle.slug}` : null);
  if (url) embed.setURL(url);

  await interaction.editReply({ embeds: [embed] });
}

// --- Companion lookups, kept in this file so they share the API helpers -----

export const statusCommand = {
  data: new SlashCommandBuilder()
    .setName("status")
    .setDescription("Live Star Citizen platform status"),

  async execute(interaction) {
    await interaction.deferReply();

    let status;
    try {
      status = await fetchRsiStatus();
    } catch (error) {
      console.error("Status lookup failed");
      console.error(error);
      await interaction.editReply("Couldn't reach the RSI status feed.");
      return;
    }

    const online = status.components.filter((component) => component.status === "operational");
    const degraded = status.components.filter((component) => component.status !== "operational");

    const embed = new EmbedBuilder()
      .setTitle("Star Citizen status")
      .setDescription(`Overall: **${status.status}**`)
      .setColor(degraded.length === 0 ? 0x3ba55d : 0xed4245)
      .setFooter({ text: `Updated ${status.updatedAt ?? "unknown"} · status.robertsspaceindustries.com` });

    if (degraded.length > 0) {
      embed.addFields({
        name: "Not operational",
        value: degraded.map((component) => `• ${component.name} — ${component.status}`).join("\n"),
      });
    }

    if (status.incidents.length > 0) {
      embed.addFields({
        name: "Open incidents",
        value: status.incidents
          .slice(0, 5)
          .map((incident) => `• ${incident.name} (${incident.impact})`)
          .join("\n"),
      });
    }

    embed.addFields({
      name: "Operational",
      value: `${online.length} of ${status.components.length} components`,
    });

    await interaction.editReply({ embeds: [embed] });
  },
};

export const commodityCommand = {
  data: new SlashCommandBuilder()
    .setName("commodity")
    .setDescription("Live buy and sell prices and the best terminals for a commodity")
    .addStringOption((option) =>
      option
        .setName("name")
        .setDescription("Commodity name or code, e.g. Titanium, Laranite, GOLD")
        .setRequired(true)
        .setMaxLength(60),
    )
    .addIntegerOption((option) =>
      option
        .setName("results")
        .setDescription("How many terminals to list per direction (default 5, max 10)")
        .setMinValue(1)
        .setMaxValue(10),
    ),

  async execute(interaction) {
    const name = interaction.options.getString("name", true).trim();
    const limit = interaction.options.getInteger("results") ?? 5;

    await interaction.deferReply();

    let result;
    try {
      result = await findCommodityPrices(name, { limit });
    } catch (error) {
      console.error("Commodity lookup failed");
      console.error(error);
      await interaction.editReply("UEX didn't answer. Try again shortly.");
      return;
    }

    if (!result) {
      await interaction.editReply(
        `No commodity matching **${name}** found. Try a name like Titanium, Laranite or Quantanium.`,
      );
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`${result.name}${result.code ? ` (${result.code})` : ""}`)
      .setColor(result.isIllegal ? 0xed4245 : ORG_COLOR);

    if (result.isIllegal) {
      embed.setDescription("**Illegal commodity.** Expect scans, interdiction and fines.");
    }

    // The headline: single best buy and sell, and the margin between them.
    const headline = [];
    if (result.bestBuy) {
      headline.push(
        `**Buy cheapest at** ${result.bestBuy.terminal} — ${number(result.bestBuy.price)} aUEC/SCU` +
          (result.bestBuy.location ? `\n${result.bestBuy.location}` : ""),
      );
    }
    if (result.bestSell) {
      headline.push(
        `**Sell highest at** ${result.bestSell.terminal} — ${number(result.bestSell.price)} aUEC/SCU` +
          (result.bestSell.location ? `\n${result.bestSell.location}` : ""),
      );
    }
    if (result.margin !== null && result.margin > 0) {
      headline.push(`**Margin:** ${number(result.margin)} aUEC per SCU on that run.`);
    }

    if (headline.length > 0) {
      embed.addFields({ name: "Best run", value: headline.join("\n\n") });
    }

    if (result.cheapest.length > 0) {
      embed.addFields({
        name: `Where to BUY (cheapest first, ${result.buyCount} terminals)`,
        value: renderList(result.cheapest, ""),
      });
    } else {
      embed.addFields({
        name: "Where to BUY",
        value: "No terminals currently selling this commodity.",
      });
    }

    if (result.mostProfitable.length > 0) {
      embed.addFields({
        name: `Where to SELL (best paying first, ${result.sellCount} terminals)`,
        value: renderList(result.mostProfitable, ""),
      });
    } else {
      embed.addFields({
        name: "Where to SELL",
        value: "No terminals currently buying this commodity.",
      });
    }

    // Discord renders <t:epoch:R> as "18 minutes ago" in each reader's own
    // locale. It must reach the footer verbatim, so build it plainly.
    const stamp = result.updatedAt
      ? `<t:${Math.floor(new Date(result.updatedAt).getTime() / 1000)}:R>`
      : "unknown";

    embed.setFooter({
      text: `Prices per SCU, player-reported via UEX · last update ${stamp}`,
    });

    await interaction.editReply({ embeds: [embed] });
  },
};
