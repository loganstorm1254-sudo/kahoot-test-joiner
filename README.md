# Kahoot Test Joiner (Web)

Browser-based Kahoot test joiner — join multiple fake players to a live game for testing.

**For testing only.**

## Push to GitHub

Install the GitHub CLI if needed, then authenticate and create the repo:

```bash
cd /Users/loganstorm/Untitled/kahoot-test-joiner-vercel
brew install gh   # or download from https://cli.github.com
gh auth login
gh repo create kahoot-test-joiner --public --source=. --remote=origin --push
```

## Deploy to Vercel

1. Push this repo to GitHub (see above)
2. Go to [vercel.com/new](https://vercel.com/new)
3. Import the repo
4. Deploy (no env vars needed for Kahoot)

The `/api/session` route proxies Kahoot session reservation (avoids browser CORS). WebSocket connections go directly from the browser to `wss://kahoot.it`.

### Blooket on Vercel

Blooket blocks join requests from Vercel’s servers (HTTP 403). Kahoot works on Vercel because the browser connects directly over WebSocket; Blooket’s join API does not allow that from this site.

**Recommended:** deploy on **Cloudflare Pages** instead (same repo, no extension):

```bash
npm install -g wrangler
wrangler pages deploy . --project-name kahoot-test-joiner
```

The `functions/api/` folder runs Blooket joins from Cloudflare’s edge.

**Alternative (stay on Vercel):** deploy the join worker once, then add this env var in Vercel:

```bash
cd cloudflare
wrangler deploy
# Set BLOOKET_JOIN_WORKER_URL to the workers.dev URL in Vercel project settings
```

## Deploy to Cloudflare Pages

1. Install Wrangler: `npm install -g wrangler`
2. Log in: `wrangler login`
3. From the repo root:

```bash
wrangler pages deploy . --project-name kahoot-test-joiner
```

Kahoot and Blooket joiners both work from the Pages URL — click Enter on site, no browser extension.

## Local dev

```bash
npm install
npx vercel dev
```

## Features

- Join up to 100 test players
- Random names per player
- Auto-pick random answers (testing)
- Kahoot-style UI
