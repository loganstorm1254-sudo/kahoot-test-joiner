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
