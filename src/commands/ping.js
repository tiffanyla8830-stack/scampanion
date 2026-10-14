import { SlashCommandBuilder } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("ping")
  .setDescription("Checks whether the bot is online");

export async function execute(interaction) {
  const sent = await interaction.reply({
    content: "Pinging...",
    withResponse: true,
  });

  const created = sent?.resource?.message?.createdTimestamp ?? sent.createdTimestamp;
  const roundTrip = created - interaction.createdTimestamp;

  await interaction.editReply(
    `Pong! Round trip ${roundTrip} ms, gateway ${Math.round(interaction.client.ws.ping)} ms`,
  );
}
