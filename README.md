# Kahoot Test Joiner (Web)

Browser-based Kahoot and Blooket test joiner — join multiple fake players to a live game for testing.

**For testing only.**

## Push to GitHub

```bash
cd /Users/loganstorm/Untitled/kahoot-test-joiner-vercel
gh auth login
git push origin main
```

## Deploy to Vercel

1. Push this repo to GitHub
2. Go to [vercel.com/new](https://vercel.com/new)
3. Import the repo
4. Deploy (no env vars needed)

- `/api/session` proxies Kahoot session reservation (CORS)
- WebSocket connections go directly from the browser to `wss://kahoot.it`
- `/api/blooket-join` proxies Blooket joins (same pattern as `/api/session` for Kahoot). The Cloudflare worker uses Browser Rendering when Blooket blocks datacenter IPs.

The first Blooket batch can take **20–40 seconds** while Chromium downloads and joins.

## Local dev

Requires [Node.js](https://nodejs.org):

```bash
npm install
npx vercel dev
```

## Features

- Join up to 100 Kahoot test players
- Blooket batch joiner (secret code `1254` on decoy)
- Random names per player
- Auto-answer questions (testing)
- Kahoot-style UI
