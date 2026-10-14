# Discord Bot

A small Discord bot built on discord.js v14 with slash commands, a clean command
loader, and graceful shutdown.

## Requirements

- Node.js 18.17 or newer
- A Discord application with a bot user

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create your environment file from the template:

   ```bash
   cp .env.example .env
   ```

3. Open `.env` and fill in the three values:

   | Variable | Where to find it |
   | --- | --- |
   | `DISCORD_TOKEN` | Developer Portal -> your app -> **Bot** -> Reset Token |
   | `CLIENT_ID` | Developer Portal -> your app -> **General Information** -> Application ID |
   | `GUILD_ID` | Discord -> right-click your test server (Developer Mode on) -> Copy Server ID |

4. Register the slash commands with Discord:

   ```bash
   npm run deploy
   ```

   Guild commands appear instantly. Run this again whenever you add or change a command.

5. Start the bot:

   ```bash
   npm start
   ```

You should see `Logged in as <name>` and `Ready in <n> guild(s)`.

## Adding the bot to a server

In the Developer Portal, go to **OAuth2** -> **URL Generator**. Select the
`bot` and `applications.commands` scopes, pick the permissions the bot actually
needs, then open the generated URL and choose your server.

## Commands

| Command | What it does |
| --- | --- |
| `/ping` | Shows the gateway latency |
| `/hello` | Greets the user who ran it |
| `/server` | Shows info about the current server |
| `/user` | Shows info about you or another member |
| `/echo` | Repeats text back, visible only to you |
| `/kick` | Kicks a member (requires Kick Members) |
| `/timeout` | Times out a member for up to 28 days (requires Moderate Members) |

## Project layout

```
discord-bot/
  src/
    bot.js               entry point: client, events, shutdown
    deploy-commands.js   registers slash commands with Discord
    commands/
      index.js           loads command modules and exports their JSON
      ping.js
      hello.js
      server.js
      user.js
      echo.js
      kick.js
      timeout.js
  .env.example
  package.json
```

## Notes on safety

- Never commit `.env`. If the token leaks, reset it in the Developer Portal straight away.
- Only grant permissions the bot uses. The moderation commands here ship with
  `setDefaultMemberPermissions` so they are hidden from members without rights, but
  Discord permissions are a UI hint — the bot's own role permissions and the target's
  role hierarchy are what actually protect you, and both are checked at runtime.
