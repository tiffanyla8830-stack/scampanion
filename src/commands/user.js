import { SlashCommandBuilder, EmbedBuilder } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("user")
  .setDescription("Shows information about a member")
  .addUserOption((option) =>
    option
      .setName("target")
      .setDescription("The member to look up (defaults to you)"),
  );

export async function execute(interaction) {
  const user = interaction.options.getUser("target") ?? interaction.user;
  const member = await interaction.guild.members
    .fetch(user.id)
    .catch(() => null);

  const embed = new EmbedBuilder()
    .setTitle(user.tag)
    .setThumbnail(user.displayAvatarURL({ size: 256 }))
    .addFields(
      {
        name: "Joined server",
        value: member
          ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>`
          : "Unknown",
        inline: true,
      },
      {
        name: "Account created",
        value: `<t:${Math.floor(user.createdTimestamp / 1000)}:D>`,
        inline: true,
      },
      {
        name: "Roles",
        value: member
          ? member.roles.cache
              .filter((role) => role.name !== "@everyone")
              .map((role) => role.toString())
              .join(", ") || "None"
          : "Unknown",
      },
    )
    .setColor(member?.displayColor || 0x5865f2);

  await interaction.reply({ embeds: [embed] });
}
