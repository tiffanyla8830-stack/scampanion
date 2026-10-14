import {
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("kick")
  .setDescription("Kicks a member from the server")
  .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
  .addUserOption((option) =>
    option.setName("target").setDescription("The member to kick").setRequired(true),
  )
  .addStringOption((option) =>
    option.setName("reason").setDescription("Why they are being kicked"),
  );

export async function execute(interaction) {
  const targetUser = interaction.options.getUser("target", true);
  const reason = interaction.options.getString("reason") ?? "No reason given";
  const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

  if (!member) {
    return interaction.reply({ content: "That member is not in this server.", ephemeral: true });
  }

  if (!member.kickable) {
    return interaction.reply({
      content: "I cannot kick that member — check my role position and permissions.",
      ephemeral: true,
    });
  }

  await member.kick(reason);
  await interaction.reply(`Kicked ${targetUser.tag}: ${reason}`);
}
