import "dotenv/config";
import { REST, Routes } from "discord.js";
import { commands } from "./commands/index.js";

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error("DISCORD_TOKEN and CLIENT_ID must both be set in .env");
  process.exit(1);
}

const body = commands.map((command) => command.data.toJSON());
const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

// Global registration: commands work in every server the bot is in, now and
// any server it is invited to later.
//
// Trade-off worth knowing: Discord propagates global commands in the
// background, so the first registration can take up to an hour to appear.
// After that they update normally. If you want commands to show instantly in
// one specific server while you are testing, pass `guild` as an argument:
//
//   npm run deploy guild
//
// which registers to GUILD_ID instead, and appears immediately.
const useGuild = process.argv.includes("guild");

if (useGuild && !GUILD_ID) {
  console.error("GUILD_ID must be set to deploy commands to a single server");
  process.exit(1);
}

const route = useGuild
  ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
  : Routes.applicationCommands(CLIENT_ID);

try {
  console.log(
    useGuild
      ? `Registering ${body.length} command(s) globally… no — to guild ${GUILD_ID} (instant)`
      : `Registering ${body.length} command(s) globally (may take up to an hour to appear)`,
  );

  const data = await rest.put(route, { body });

  console.log(`Registered ${data.length} command(s)`);
  console.log(data.map((command) => `/${command.name}`).join(", "));

  if (!useGuild) {
    console.log(
      "\nGlobal commands appear in every server the bot is in. They can take",
    );
    console.log(
      "up to an hour on first registration — Discord caches them client-side.",
    );
  }
} catch (error) {
  console.error("Failed to register commands");
  console.error(error);
  process.exit(1);
}
