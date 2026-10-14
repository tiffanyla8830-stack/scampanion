import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import {
  addShip,
  findShips,
  hangarTotals,
  listShips,
  removeShip,
} from "../data/store.js";

const ORG_COLOR = 0x2f6f9f;

export const data = new SlashCommandBuilder()
  .setName("hangar")
  .setDescription("Manage your ships in the org hangar")
  .addSubcommand((sub) =>
    sub
      .setName("add")
      .setDescription("Add a ship to your hangar")
      .addStringOption((option) =>
        option
          .setName("ship")
          .setDescription("Ship name, e.g. Carrack")
          .setRequired(true)
          .setMaxLength(80),
      )
      .addIntegerOption((option) =>
        option
          .setName("quantity")
          .setDescription("How many (default 1)")
          .setMinValue(1)
          .setMaxValue(20),
      )
      .addStringOption((option) =>
        option.setName("notes").setDescription("Loaner, upgraded, melt candidate…").setMaxLength(200),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("remove")
      .setDescription("Remove one of a ship from your hangar")
      .addStringOption((option) =>
        option.setName("ship").setDescription("Ship name").setRequired(true).setMaxLength(80),
      ),
  )
  .addSubcommand((sub) => sub.setName("list").setDescription("Show your hangar"))
  .addSubcommand((sub) =>
    sub
      .setName("find")
      .setDescription("See who in the org has a given ship")
      .addStringOption((option) =>
        option.setName("ship").setDescription("Ship name to search for").setRequired(true).setMaxLength(80),
      ),
  );

export async function execute(interaction) {
  const subcommand = interaction.options.getSubcommand();
  const { guildId, user } = interaction;

  if (subcommand === "add") {
    const ship = interaction.options.getString("ship", true).trim();
    const quantity = interaction.options.getInteger("quantity") ?? 1;
    const notes = interaction.options.getString("notes");

    const result = addShip({ guildId, userId: user.id, shipName: ship, quantity, notes });

    const totals = hangarTotals({ guildId });

    const embed = new EmbedBuilder()
      .setTitle(result.updated ? "Hangar updated" : "Ship added")
      .setDescription(
        result.updated
          ? `**${ship}** ×${quantity} added to your existing entry.`
          : `**${ship}** ×${quantity} is now in your hangar.`,
      )
      .setColor(ORG_COLOR)
      .setFooter({ text: `Org hangar: ${totals.pilots} pilots, ${totals.ships} ships` });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  if (subcommand === "remove") {
    const ship = interaction.options.getString("ship", true).trim();
    const result = removeShip({ guildId, userId: user.id, shipName: ship });

    if (!result.found) {
      await interaction.reply({
        content: `You don't have a **${ship}** in your hangar.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      content:
        result.remaining > 0
          ? `Removed one **${ship}** — ${result.remaining} left in your hangar.`
          : `Removed **${ship}** from your hangar.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === "list") {
    const ships = listShips({ guildId, userId: user.id });

    if (ships.length === 0) {
      await interaction.reply({
        content: "Your hangar is empty. Add a ship with `/hangar add`.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const lines = ships.map((ship) => {
      const count = ship.quantity > 1 ? ` ×${ship.quantity}` : "";
      const note = ship.notes ? ` — *${ship.notes}*` : "";
      return `• **${ship.ship_name}**${count}${note}`;
    });

    const embed = new EmbedBuilder()
      .setTitle(`${user.username}'s hangar`)
      .setDescription(lines.join("\n"))
      .setColor(ORG_COLOR)
      .setFooter({ text: `${ships.reduce((sum, ship) => sum + ship.quantity, 0)} ships` });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  // find
  const ship = interaction.options.getString("ship", true).trim();
  const matches = findShips({ guildId, shipName: ship });

  if (matches.length === 0) {
    await interaction.reply({
      content: `Nobody in the org has a ship matching **${ship}**.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Group the matches by pilot so one person with three hulls is one entry.
  const byPilot = new Map();
  for (const match of matches) {
    const entry = byPilot.get(match.user_id) ?? [];
    entry.push(match.quantity > 1 ? `${match.ship_name} ×${match.quantity}` : match.ship_name);
    byPilot.set(match.user_id, entry);
  }

  const lines = [...byPilot.entries()].map(
    ([userId, ships]) => `<@${userId}> — ${ships.join(", ")}`,
  );

  const embed = new EmbedBuilder()
    .setTitle(`Who has a ${ship}?`)
    .setDescription(lines.join("\n"))
    .setColor(ORG_COLOR)
    .setFooter({
      text: `${byPilot.size} pilot(s) · ${matches.reduce((sum, m) => sum + m.quantity, 0)} hull(s)`,
    });

  await interaction.reply({ embeds: [embed] });
}

export const permissions = PermissionFlagsBits.SendMessages;
