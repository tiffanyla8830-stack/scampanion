import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { syncHangarToSheet, sheetsConfigured } from "../sheets.js";
import { hangarTotals } from "../data/store.js";

const ORG_COLOR = 0x2f6f9f;

export const data = new SlashCommandBuilder()
  .setName("sync")
  .setDescription("Push the hangar roster to the org's Google Sheet")
  .setDefaultMemberPermissions(1n << 3n); // Administrator

export async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!sheetsConfigured()) {
    await interaction.editReply(
      "**Google Sheets isn't configured on this bot.**\n" +
        "Set `GOOGLE_SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL` and " +
        "`GOOGLE_PRIVATE_KEY` in the host's environment variables, then restart.\n" +
        "See `HOSTING-sheets.md` in the repo.",
    );
    return;
  }

  let result;
  try {
    result = await syncHangarToSheet({ guildId: interaction.guildId });
  } catch (error) {
    console.error("Hangar sync failed");
    console.error(error);
    await interaction.editReply(
      `**Sync failed.**\n\`\`\`\n${String(error?.message ?? error).slice(0, 600)}\n\`\`\``,
    );
    return;
  }

  if (!result.ok) {
    await interaction.editReply("Sheets isn't configured on this bot.");
    return;
  }

  const totals = hangarTotals({ guildId: interaction.guildId });

  const embed = new EmbedBuilder()
    .setTitle("Hangar synced to Google Sheets")
    .setColor(ORG_COLOR)
    .setDescription(
      `Wrote **${result.rowCount}** row${result.rowCount === 1 ? "" : "s"} ` +
        `for **${result.pilots}** pilot${result.pilots === 1 ? "" : "s"} to the Hangar tab.`,
    )
    .setFooter({
      text:
        `Sheet: ${result.spreadsheetId} · ` +
        `the tab is a mirror, so rows for removed ships are gone on the next sync`,
    });

  embed.addFields({
    name: "Org totals",
    value: `${totals.pilots} pilots · ${totals.ships} ships`,
    inline: true,
  });

  await interaction.editReply({ embeds: [embed] });
}
