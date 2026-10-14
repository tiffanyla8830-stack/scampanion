import { SlashCommandBuilder } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("hello")
  .setDescription("Greets you");

export async function execute(interaction) {
  await interaction.reply(`Hello, ${interaction.user}!`);
}
