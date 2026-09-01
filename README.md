# Kahoot Test Joiner (Web)

Browser-based Kahoot test joiner — join multiple fake players to a live game for testing.

**For testing only.**

## Deploy to Vercel

1. Push this repo to GitHub
2. Go to [vercel.com/new](https://vercel.com/new)
3. Import the repo
4. Deploy (no env vars needed)

The `/api/session` route proxies Kahoot session reservation. The `/api/ws` route proxies the Kahoot WebSocket (required because browsers cannot connect directly to `wss://kahoot.it` from a web page).

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
