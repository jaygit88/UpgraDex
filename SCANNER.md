# Setting up the card scanner

The Scan tab sends photos to a small server (a Cloudflare Worker in `scanner/`), which asks Claude to read the cards:

| Scan | Model | Rough cost |
|---|---|---|
| Quick scan (one card) | Claude Haiku 5.5 | well under 0.1p a scan |
| Catalogue (binder page, up to 9 cards) | Claude Sonnet 5.5 | about 2p a page (~£2.50 for a whole 1,000-card collection) |

The server keeps the Anthropic key secret, and a passcode stops anyone else using it.
There are two copies: **upgradex-scanner** (used by the real app, deployed from `main`) and
**upgradex-scanner-test** (used by UpgraDex Test, deployed from `test`).

## One-off setup (about 15 minutes)

### 1. Anthropic (pays for the card reading)
1. Sign up at https://console.anthropic.com.
2. **Billing:** add a payment card and buy a little credit (e.g. $5).
3. **Limits:** optionally set a monthly spend limit, so it can never cost more than you expect.
4. **API keys → Create key:** name it "UpgraDex" and copy the key (starts `sk-ant-`). You only see it once.

### 2. Cloudflare (runs the scanner, free)
1. Sign up at https://dash.cloudflare.com.
2. Open **Compute → Workers & Pages**. The **Account details** box on the right shows your **Subdomain** (this account's is `jay-tuck1988.workers.dev`, already set in `js/config.js`).
3. Copy the **Account ID** from the same box.
4. **My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template → Continue → Create Token.** Copy the token.

### 3. Pick a passcode
Any word or phrase, e.g. `squirtle-squad-42`. You'll type it into UpgraDex on each device.

### 4. Give GitHub the four secrets
In the repo: **Settings → Secrets and variables → Actions → New repository secret**, four times:

| Name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | the Cloudflare token from 2.4 |
| `CLOUDFLARE_ACCOUNT_ID` | the Account ID from 2.3 |
| `ANTHROPIC_API_KEY` | the Anthropic key from 1.4 |
| `APP_PASSCODE` | your passcode from 3 |

### 5. Deploy
**Actions → "Deploy scanner (Cloudflare Worker)" → Run workflow.** Choose branch `test` for the test scanner, or `main` for the real one.
After that it redeploys by itself whenever the scanner code changes.

### 6. Connect the app
In UpgraDex (or UpgraDex Test) go to **Settings → Scanner**:
The address fills itself in, so just type the passcode and tap **Save & check**. It should say "Connected".

## Running the tests
```bash
cd scanner && npm ci && npm test
```
