import {
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

const MAX_MINUTES = 28 * 24 * 60; // Discord caps timeouts at 28 days.

export const data = new SlashCommandBuilder()
  .setName("timeout")
  .setDescription("Times out a member")
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addUserOption((option) =>
    option.setName("target").setDescription("The member to time out").setRequired(true),
  )
  .addIntegerOption((option) =>
    option
      .setName("minutes")
      .setDescription("Duration in minutes (max 40320 = 28 days)")
      .setMinValue(1)
      .setMaxValue(MAX_MINUTES)
      .setRequired(true),
  )
  .addStringOption((option) =>
    option.setName("reason").setDescription("Why they are being timed out"),
  );

export async function execute(interaction) {
  const targetUser = interaction.options.getUser("target", true);
  const minutes = interaction.options.getInteger("minutes", true);
  const reason = interaction.options.getString("reason") ?? "No reason given";
  const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

  if (!member) {
    return interaction.reply({ content: "That member is not in this server.", ephemeral: true });
  }

  if (!member.moderatable) {
    return interaction.reply({
      content: "I cannot time out that member — check my role position and permissions.",
      ephemeral: true,
    });
  }

  const until = new Date(Date.now() + minutes * 60_000);
  await member.timeout(minutes * 60_000, reason);

  await interaction.reply(
    `Timed out ${targetUser.tag} until <t:${Math.floor(until.getTime() / 1000)}:f> — ${reason}`,
  );
}
