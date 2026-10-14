import "dotenv/config";
import {
  ActivityType,
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  MessageFlags,
} from "discord.js";
import { commands } from "./commands/index.js";
import { handleButton } from "./commands/poll.js";
import { pageFromCustomId, renderPage as renderHelpPage } from "./commands/help.js";

const required = ["DISCORD_TOKEN", "CLIENT_ID", "GUILD_ID"];
const missing = required.filter((name) => !process.env[name]);

if (missing.length > 0) {
  console.error(`Missing required environment variable(s): ${missing.join(", ")}`);
  console.error("Copy .env.example to .env and fill in the values.");
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.commands = new Collection();
for (const command of commands) {
  client.commands.set(command.data.name, command);
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  console.log(`Ready in ${readyClient.guilds.cache.size} guild(s)`);

  readyClient.user.setActivity("the org hangar", { type: ActivityType.Watching });
});

client.on(Events.InteractionCreate, async (interaction) => {
  // Buttons on a poll arrive as component interactions, not commands, so they
  // need routing before the command lookup below.
  if (interaction.isButton() && interaction.customId.startsWith("poll:")) {
    try {
      await handleButton(interaction);
    } catch (error) {
      console.error("Error handling poll button");
      console.error(error);

      if (!interaction.replied && !interaction.deferred) {
        await interaction
          .reply({
            content: "Something went wrong with that vote.",
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => {});
      }
    }
    return;
  }

  // Help pages switch in place, so the button is handled the same way.
  if (interaction.isButton() && interaction.customId.startsWith("help:")) {
    const page = pageFromCustomId(interaction.customId);

    try {
      if (page === null) {
        await interaction.deferUpdate();
      } else {
        await renderHelpPage(interaction, page);
      }
    } catch (error) {
      console.error("Error handling help button");
      console.error(error);
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);

  if (!command) {
    console.warn(`No handler registered for /${interaction.commandName}`);
    await interaction.reply({
      content: "That command is not available right now.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`Error running /${interaction.commandName}`);
    console.error(error);

    const payload = {
      content: "Something went wrong while running that command.",
      flags: MessageFlags.Ephemeral,
    };

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

client.on(Events.Error, (error) => {
  console.error("Gateway error");
  console.error(error);
});

// Without these, an unhandled rejection kills the process with no useful trace.
process.on("unhandledRejection", (error) => {
  console.error("Unhandled promise rejection");
  console.error(error);
});

async function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  await client.destroy();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

await client.login(process.env.DISCORD_TOKEN);
