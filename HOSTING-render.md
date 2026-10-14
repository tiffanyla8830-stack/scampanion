# SCcompanion — hosting on Render

Render reads the `render.yaml` blueprint in this folder, so most of the setup is
already written. Push the repo, then point Render at it.

## What the blueprint creates

A single **worker** service named `sccompanion`, running from the `Dockerfile`,
with:

- a **1 GB disk mounted at `/data`** — this is what keeps hangar entries
- `DATA_DIR=/data`, which points the database at that disk
- `numInstances: 1`, because two replicas would mean two bots answering the same
  interactions

`DISCORD_TOKEN`, `CLIENT_ID` and `GUILD_ID` are marked `sync: false`, so Render
prompts for them in the dashboard instead of expecting them in the file. Tokens
should never be committed.

## Deploying

1. Push the bot to GitHub (private is fine). Check `.env` is gitignored first.
2. In [Render](https://render.com): **New +** → **Blueprint** → pick the repo.
3. Render reads `render.yaml` and shows the service it will create.
4. When prompted, paste in `DISCORD_TOKEN`, `CLIENT_ID` and `GUILD_ID`.
5. **Apply**. First build takes a few minutes — Docker image, dependency
   install, then start.

## Verifying it worked

Open the service's **Logs** tab. You want:

```
Database: /data/org.sqlite
Logged in as SCcompanion#9291
```

The `Database:` line confirms the file is on the disk. If it shows a path under
`/app`, the disk isn't mounted and data will reset on every deploy.

Do not look for a public URL — a gateway bot takes no inbound connections, and
the blueprint deliberately creates no web service and no exposed port.

## Changing region or plan

Both are set in `render.yaml` and can be edited before the first deploy:

```yaml
plan: starter
region: frankfurt
```

`frankfurt` is the closest Render region to the UK. `starter` is the smallest
paid tier; the free tier spins a service down after inactivity, which a gateway
bot cannot tolerate — Discord would show *"The application did not respond"*
whenever it was asleep.

## Registering slash commands

Commands only need registering when they change, so run it once from your own
machine:

```bash
npm run deploy
```

It registers against your server regardless of where the bot itself runs. Or use
Render's shell tab and run `npm run deploy` there.

## Troubleshooting

**Commands time out in Discord** — the service is spun down or crashed. Check
the logs for the two startup lines.

**Hangar entries reset after a deploy** — the disk isn't mounted at `/data`, or
`DATA_DIR` doesn't match. The `Database:` log line settles it.

**Build fails on `npm ci`** — that happens if no `package-lock.json` was
committed. The Dockerfile falls back to `npm install`, but committing the lock
file is the better fix.
