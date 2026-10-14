import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

// One active poll per message, keyed by the message id so each poll's votes
// stay independent of every other poll in the channel.
export const activePolls = new Map();

const MAX_OPTIONS = 5;

export const data = new SlashCommandBuilder()
  .setName("poll")
  .setDescription("Posts a poll members can vote on with buttons")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .addStringOption((option) =>
    option
      .setName("question")
      .setDescription("The question to ask")
      .setRequired(true)
      .setMaxLength(200),
  )
  .addStringOption((option) =>
    option
      .setName("option1")
      .setDescription("First answer choice")
      .setRequired(true)
      .setMaxLength(60),
  )
  .addStringOption((option) =>
    option
      .setName("option2")
      .setDescription("Second answer choice")
      .setRequired(true)
      .setMaxLength(60),
  )
  .addStringOption((option) =>
    option.setName("option3").setDescription("Third answer choice").setMaxLength(60),
  )
  .addStringOption((option) =>
    option.setName("option4").setDescription("Fourth answer choice").setMaxLength(60),
  )
  .addStringOption((option) =>
    option.setName("option5").setDescription("Fifth answer choice").setMaxLength(60),
  );

export async function execute(interaction) {
  const question = interaction.options.getString("question", true);

  const options = [];
  for (let index = 1; index <= MAX_OPTIONS; index += 1) {
    const label = interaction.options.getString(`option${index}`);
    if (label) options.push(label.trim());
  }

  const embed = new EmbedBuilder()
    .setTitle("Poll")
    .setDescription(`**${question}**`)
    .setColor(0x5865f2)
    .setFooter({ text: "Click a button to vote — click another to change your vote." });

  for (let index = 0; index < options.length; index += 1) {
    embed.addFields({
      name: `${index + 1}. ${options[index]}`,
      value: "0 votes",
      inline: true,
    });
  }

  const row = new ActionRowBuilder().addComponents(
    options.map((label, index) =>
      new ButtonBuilder()
        .setCustomId(`poll:${index}`)
        .setLabel(`${index + 1}`)
        .setStyle(ButtonStyle.Primary),
    ),
  );

  const message = await interaction.reply({
    embeds: [embed],
    components: [row],
    withResponse: true,
  });

  const messageId = message.resource.message.id;

  activePolls.set(messageId, {
    question,
    options,
    // voterId -> option index, so re-clicking moves a vote instead of adding one
    votes: new Map(),
  });

  // Clean up the in-memory record after a day so a long-lived bot does not
  // accumulate every poll it has ever posted.
  setTimeout(() => activePolls.delete(messageId), 24 * 60 * 60 * 1000).unref();
}

export function buildPollEmbed(poll) {
  const counts = new Array(poll.options.length).fill(0);
  for (const choice of poll.votes.values()) counts[choice] += 1;

  const total = poll.votes.size;

  const embed = new EmbedBuilder()
    .setTitle("Poll")
    .setDescription(`**${poll.question}**`)
    .setColor(0x5865f2)
    .setFooter({
      text:
        total === 1
          ? "1 vote — click a button to vote or change your vote."
          : `${total} votes — click a button to vote or change your vote.`,
    });

  for (let index = 0; index < poll.options.length; index += 1) {
    const share = total === 0 ? 0 : Math.round((counts[index] / total) * 100);
    embed.addFields({
      name: `${index + 1}. ${poll.options[index]}`,
      value: `${counts[index]} ${counts[index] === 1 ? "vote" : "votes"} (${share}%)`,
      inline: true,
    });
  }

  return embed;
}

// Handles a button press on a poll. Called from the interaction handler in
// bot.js, which routes any customId that starts with "poll:".
export async function handleButton(interaction) {
  const index = Number(interaction.customId.split(":")[1]);
  const poll = activePolls.get(interaction.message.id);

  if (!poll || !Number.isInteger(index) || index < 0 || index >= poll.options.length) {
    await interaction.reply({
      content: "This poll is no longer active.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const previous = poll.votes.get(interaction.user.id);

  if (previous === index) {
    poll.votes.delete(interaction.user.id);
    await interaction.reply({
      content: `Removed your vote for **${poll.options[index]}**.`,
      flags: MessageFlags.Ephemeral,
    });
  } else {
    poll.votes.set(interaction.user.id, index);
    await interaction.reply({
      content: previous === undefined
        ? `Voted for **${poll.options[index]}**.`
        : `Changed your vote to **${poll.options[index]}**.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const row = new ActionRowBuilder().addComponents(
    poll.options.map((label, optionIndex) =>
      new ButtonBuilder()
        .setCustomId(`poll:${optionIndex}`)
        .setLabel(`${optionIndex + 1}`)
        .setStyle(
          poll.votes.get(interaction.user.id) === optionIndex
            ? ButtonStyle.Success
            : ButtonStyle.Primary,
        ),
    ),
  );

  // update() refreshes the message every voter sees, without spamming replies.
  await interaction.message.edit({
    embeds: [buildPollEmbed(poll)],
    components: [row],
  });
}
