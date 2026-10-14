import {
  AttachmentBuilder,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { closeDb, databasePath, exportAll } from "../data/store.js";

const ORG_COLOR = 0x2f6f9f;

export const data = new SlashCommandBuilder()
  .setName("backup")
  .setDescription("Export the hangar database as a file you can keep")
  .setDefaultMemberPermissions(1n << 3n) // Administrator
  .addBooleanOption((option) =>
    option
      .setName("visible")
      .setDescription("Post the file publicly instead of privately (default: private)"),
  );

export async function execute(interaction) {
  const visible = interaction.options.getBoolean("visible") ?? false;

  await interaction.deferReply({
    flags: visible ? undefined : MessageFlags.Ephemeral,
  });

  let dump;
  try {
    dump = exportAll();
  } catch (error) {
    console.error("Backup export failed");
    console.error(error);
    await interaction.editReply(
      `**Backup failed.**\n\`\`\`\n${String(error?.message ?? error).slice(0, 500)}\n\`\`\``,
    );
    return;
  }

  // The dump is plain JSON: readable, diffable, and restorable by hand if it
  // ever comes to that.
  const payload = JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      exportedFrom: databasePath(),
      ...dump,
    },
    null,
    2,
  );

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const file = new AttachmentBuilder(Buffer.from(payload, "utf8"), {
    name: `sccompanion-backup-${stamp}.json`,
  });

  const embed = new EmbedBuilder()
    .setTitle("Database backup")
    .setColor(ORG_COLOR)
    .addFields(
      { name: "Hangar entries", value: String(dump.hangarShips.length), inline: true },
      { name: "Pilots", value: String(new Set(dump.hangarShips.map((row) => row.user_id)).size), inline: true },
      { name: "Size", value: `${(payload.length / 1024).toFixed(1)} KB`, inline: true },
    )
    .setFooter({ text: `Source: ${databasePath()}` });

  await interaction.editReply({ embeds: [embed], files: [file] });
}

// Used by the scheduled path in bot.js, and by /backup if ever needed
// unattended. Kept separate so the export logic has one home.
export function buildBackupPayload() {
  const dump = exportAll();
  return {
    payload: JSON.stringify(
      { exportedAt: new Date().toISOString(), exportedFrom: databasePath(), ...dump },
      null,
      2,
    ),
    counts: {
      hangarShips: dump.hangarShips.length,
      pilots: new Set(dump.hangarShips.map((row) => row.user_id)).size,
    },
  };
}

export { closeDb };
