import { SlashCommandBuilder, MessageFlags } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("echo")
  .setDescription("Repeats your text back, visible only to you")
  .addStringOption((option) =>
    option
      .setName("text")
      .setDescription("The text to repeat")
      .setRequired(true)
      .setMaxLength(2000),
  );

export async function execute(interaction) {
  const text = interaction.options.getString("text", true);

  await interaction.reply({
    content: text,
    flags: MessageFlags.Ephemeral,
  });
}
