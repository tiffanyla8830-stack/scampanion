# SCcompanion — hosting on Railway

Railway reads nothing from a config file: you connect a repo, it detects Node,
and you supply settings in the dashboard. These are the settings that matter.

## 1. Push the bot to GitHub

Railway deploys from a repo, so the bot needs to be in one first. A private repo
is fine.

Check that `.gitignore` excludes `.env` and `data/` before the first commit —
the token must never reach the repo, and the database is runtime state, not
source.

## 2. Create the service

1. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
2. Pick the repo. Railway detects Node and starts a build.
3. **Settings → Deploy** → set the start command to `npm start` if it wasn't
   detected. The bot runs as a worker, not a web service.

## 3. Set the environment variables

**Variables** tab → **New Variable**, three of them:

| Key | Value |
| --- | --- |
| `DISCORD_TOKEN` | your bot token, from the Developer Portal |
| `CLIENT_ID` | your application ID |
| `GUILD_ID` | your server ID |
| `DATA_DIR` | `/data` |

`DATA_DIR` is what points the database at the volume you add next. Without both
halves, hangar entries are wiped on every deploy.

## 4. Add the volume — this is the step that preserves hangar data

**Settings → Volumes → Add Volume**, mount path:

```
/data
```

That must match `DATA_DIR` exactly. With the volume mounted there, `org.sqlite`
is written to persistent storage and survives redeploys.

Railway volumes are per-service and single-replica, which suits a Discord
gateway bot — two replicas would mean two bots answering the same interactions.

## 5. Deploy and verify

Deploy, then open the logs. You want two lines:

```
Database: /data/org.sqlite
Logged in as SCcompanion#9291
```

The `Database:` line is the one that matters — it confirms the file is on the
volume rather than in the container. If it shows a path under `/app`, `DATA_DIR`
isn't set and data will reset on every deploy.

## Registering commands from the host

Slash commands only need registering when they change, so you can run the deploy
once from your own machine and leave it:

```bash
npm run deploy
```

That registers against your server wherever it runs from — the bot process
doesn't need to be the one doing it. If you'd rather do it from Railway, use the
dashboard's shell and run `npm run deploy` there.

## Cost

The free trial credit covers a few weeks. After that a gateway bot needs an
always-on plan — on Railway that's the Hobby tier, roughly $5/month. Sleeping or
credit-exhausted services will stop answering commands, which shows up in
Discord as *"The application did not respond"*.

## Troubleshooting

**Commands time out in Discord** — the service is asleep, out of credit, or
crashed. Check the logs for the two startup lines.

**Hangar entries reset after a deploy** — the volume isn't mounted at the path
`DATA_DIR` names, or `DATA_DIR` isn't set. The `Database:` line in the logs
tells you which.
