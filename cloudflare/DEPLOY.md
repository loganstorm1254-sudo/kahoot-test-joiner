# Deploy the Blooket worker (no npm on your Mac needed)

The joiner calls this worker when Blooket blocks Vercel’s IP. Deploy it once from GitHub — GitHub runs `npm` and `wrangler` for you.

## One-time setup (~2 minutes)

### 1. Cloudflare API token

1. Open [Cloudflare API tokens](https://dash.cloudflare.com/profile/api-tokens)
2. **Create Token** → use the **Edit Cloudflare Workers** template
3. Copy the token (you only see it once)

### 2. Account ID

1. Open [Cloudflare Workers](https://dash.cloudflare.com/)
2. Copy the **Account ID** from the right sidebar (or from the URL: `dash.cloudflare.com/<ACCOUNT_ID>/...`)

### 3. GitHub secrets

1. Open your repo on GitHub → **Settings** → **Secrets and variables** → **Actions**
2. **New repository secret**:
   - Name: `CLOUDFLARE_API_TOKEN` → paste the token
3. **New repository secret**:
   - Name: `CLOUDFLARE_ACCOUNT_ID` → paste the account ID

### 4. Enable Browser Rendering

1. In Cloudflare dashboard → **Workers & Pages** → **Browser Rendering**
2. Turn it on if it isn’t already (free tier includes limited daily minutes)

## Deploy

Push to `main` (or re-run the workflow):

```bash
git push origin main
```

Then on GitHub: **Actions** → **Deploy Blooket Worker** → confirm it’s green.

Or trigger manually: **Actions** → **Deploy Blooket Worker** → **Run workflow**.

Worker URL (unchanged): `https://kahoot-test-joiner-blooket.stormy1254456.workers.dev`

## Optional: deploy from your Mac

Only if you install Node later: https://nodejs.org (LTS installer), then:

```bash
cd cloudflare
npm install
npx wrangler deploy
```
