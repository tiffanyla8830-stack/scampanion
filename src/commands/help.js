import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";

const ORG_COLOR = 0x2f6f9f;

// Pages of the help browser. Order matters — the first is what /help opens on.
const PAGES = [
  {
    id: "trading",
    label: "Trading",
    emoji: "📈",
    title: "Trading & market",
    intro:
      "Live prices and routes from UEX Corp. Player-reported and updated hourly, " +
      "so verify stock in game before you commit cargo.",
    entries: [
      {
        usage: "/calc commodity:<good> scu:<n> [budget:<aUEC>] [sell_at:<price>]",
        what:
          "Works out one run: what the cargo costs, what it sells for, and the " +
          "profit. Caps the load against reported stock and your budget.",
        example: "/calc commodity:Laranite scu:46 budget:500000",
      },
      {
        usage: "/commodity name:<good> [results:<n>]",
        what:
          "Where a commodity is bought and sold, ranked. Shows the best run, " +
          "the margin, and every terminal either way. Accepts a name or a code.",
        example: "/commodity name:Laranite",
      },
      {
        usage: "/route ship:<name> [budget:<aUEC>] [legal_only:<bool>]",
        what:
          "Reads your ship's cargo capacity, then ranks runs that actually fit " +
          "your hold, by profit per trip rather than per SCU.",
        example: "/route ship:\"Cutlass Black\" budget:500000",
      },
      {
        usage: "/terminal name:<place>",
        what:
          "Everything one location trades, both directions — what you can buy " +
          "there and what it pays for. Partial names work.",
        example: "/terminal name:Orinth",
      },
      {
        usage: "/locate item:<name>",
        what:
          "Which shop stocks a component, weapon or piece of gear, with prices " +
          "and the full location chain.",
        example: "/locate item:Atlas",
      },
    ],
  },
  {
    id: "hangar",
    label: "Hangar",
    emoji: "🚀",
    title: "Hangar & fleet",
    intro:
      "A shared list of what members fly. Entries are self-reported — this is a " +
      "planning aid, not proof of ownership.",
    entries: [
      {
        usage: "/hangar add ship:<name> [quantity:<n>] [notes:<text>]",
        what:
          "Registers a ship to you. Adding the same ship twice increases the " +
          "quantity rather than creating a duplicate.",
        example: "/hangar add ship:Carrack notes:Melt candidate",
      },
      {
        usage: "/hangar remove ship:<name>",
        what: "Removes one of a ship. Removes the entry entirely at zero.",
        example: "/hangar remove ship:Carrack",
      },
      {
        usage: "/hangar list",
        what: "Your ships. Only you can see the reply.",
      },
      {
        usage: "/hangar find ship:<name>",
        what:
          "Who has a given ship, grouped by pilot. Substring matching, so " +
          "`carrack` finds `Anvil Carrack`.",
        example: "/hangar find ship:Cutlass",
      },
    ],
  },
  {
    id: "reference",
    label: "Reference",
    emoji: "📖",
    title: "Game reference",
    intro:
      "Ship and platform data from the Star Citizen Wiki API and the live RSI " +
      "status feed.",
    entries: [
      {
        usage: "/ship name:<name>",
        what:
          "Live stats for a hull — manufacturer, role, crew, cargo, mass, " +
          "dimensions, speed and pledge price.",
        example: "/ship name:Carrack",
      },
      {
        usage: "/status",
        what:
          "Live Star Citizen platform status and any open incidents. The only " +
          "real-time source here.",
      },
    ],
  },
  {
    id: "server",
    label: "Server",
    emoji: "🛠️",
    title: "Server & utility",
    intro: "Everything else the bot does in a server.",
    entries: [
      {
        usage: "/poll question:<text> option1:<text> option2:<text> [option3..5]",
        what:
          "Posts a vote with buttons. Counts update live, clicking a different " +
          "button moves your vote, clicking the same one removes it. Staff only.",
        example: "/poll question:\"Game night?\" option1:Friday option2:Saturday",
      },
      {
        usage: "/user [target:<@member>]",
        what: "Member info — join date, account age and roles.",
      },
      {
        usage: "/server",
        what: "Server info — member count, owner and creation date.",
      },
      {
        usage: "/ping · /hello · /echo text:<text>",
        what: "Latency check, a greeting, and a private echo of your text.",
      },
      {
        usage: "/kick target:<@member> [reason:<text>]",
        what: "Kicks a member. Needs Kick Members and a role above theirs.",
      },
      {
        usage: "/timeout target:<@member> minutes:<n> [reason:<text>]",
        what:
          "Times a member out, up to 28 days. Needs Moderate Members and a role above theirs.",
      },
    ],
  },
];

function buildPage(index) {
  const page = PAGES[index];

  const body = page.entries
    .map((entry) => {
      const lines = [`**\`${entry.usage}\`**`, entry.what];
      if (entry.example) lines.push(`*e.g.* \`${entry.example}\``);
      return lines.join("\n");
    })
    .join("\n\n");

  return new EmbedBuilder()
    .setTitle(`📘 SCcompanion — ${page.title}`)
    .setDescription(`${page.intro}\n\n${body}`)
    .setColor(ORG_COLOR)
    .setFooter({
      text: `Page ${index + 1} of ${PAGES.length} · buttons below switch section · data: Star Citizen Wiki + UEX`,
    });
}

// One button per page. The active page's button is disabled so it reads as
// "you are here" rather than as an action that does nothing.
function buildRow(activeIndex) {
  return new ActionRowBuilder().addComponents(
    PAGES.map((page, index) =>
      new ButtonBuilder()
        .setCustomId(`help:${index}`)
        .setLabel(page.label)
        .setEmoji(page.emoji)
        .setStyle(
          index === activeIndex ? ButtonStyle.Primary : ButtonStyle.Secondary,
        )
        .setDisabled(index === activeIndex),
    ),
  );
}

export const HELP_PAGE_COUNT = PAGES.length;

// Which page a customId refers to, or null if it isn't a help button.
export function pageFromCustomId(customId) {
  const raw = customId.split(":")[1];
  const index = Number(raw);
  if (!Number.isInteger(index) || index < 0 || index >= PAGES.length) return null;
  return index;
}

export async function renderPage(interaction, index) {
  await interaction.update({
    embeds: [buildPage(index)],
    components: [buildRow(index)],
  });
}

export const data = new SlashCommandBuilder()
  .setName("help")
  .setDescription("What the bot can do, and how to use it")
  .addBooleanOption((option) =>
    option
      .setName("visible")
      .setDescription("Post publicly so others can see it (default: yes)"),
  );

export async function execute(interaction) {
  // Public by default so it can double as an onboarding message, but the
  // caller can keep it private with visible:false.
  const visible = interaction.options.getBoolean("visible") ?? true;

  await interaction.reply({
    embeds: [buildPage(0)],
    components: [buildRow(0)],
    flags: visible ? undefined : MessageFlags.Ephemeral,
  });
}
