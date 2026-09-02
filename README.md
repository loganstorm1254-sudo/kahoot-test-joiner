# Kahoot Test Joiner (Web)

Browser-based Kahoot test joiner — join multiple fake players to a live game for testing.

**For testing only.**

## Push to GitHub

```bash
cd /Users/loganstorm/Untitled/kahoot-test-joiner-vercel
git push origin main
```

## Deploy to Vercel

1. Push this repo to GitHub
2. Go to [vercel.com/new](https://vercel.com/new)
3. Import the repo
4. Deploy (no env vars needed)

- `/api/session` proxies Kahoot session reservation (CORS)
- WebSocket connections go directly from the browser to `wss://kahoot.it`

## Local dev

Requires [Node.js](https://nodejs.org):

```bash
npm install
npx vercel dev
```

## Features

- Join up to 44 Kahoot test players
- Random names per player
- Auto-answer questions (testing)
- Kahoot-style UI
- Secret joiner: type `qw` on the decoy page, or click **Make**
