import "dotenv/config";
import { REST, Routes } from "discord.js";
import { commands } from "./commands/index.js";

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("DISCORD_TOKEN, CLIENT_ID and GUILD_ID must all be set in .env");
  process.exit(1);
}

const body = commands.map((command) => command.data.toJSON());
const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

try {
  console.log(`Registering ${body.length} command(s) with guild ${GUILD_ID}`);

  const data = await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body },
  );

  console.log(`Registered ${data.length} command(s)`);
  console.log(data.map((command) => `/${command.name}`).join(", "));
} catch (error) {
  console.error("Failed to register commands");
  console.error(error);
  process.exit(1);
}
