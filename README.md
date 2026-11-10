# UpgraDex

A web app (installable on a tablet or phone) for a one-of-each Pokédex card collection:

- **Pokédex grid** of all 1,025 Pokémon showing the card owned for each, with the missing ones highlighted.
- **Pick the exact card** from every printed card of that Pokémon, with pictures, set, number and rarity
  (Pokémon TCG Pocket cards are left out).
- **Language tag** (EN / JP / KR) on each card, so each card appears once instead of three times.
- **Up to 3 ranked upgrades** per Pokémon, with "Got it!" to promote an upgrade to the owned card (with undo).
- **Typical recent price** for every card (Cardmarket 30-day average and TCGplayer market price, refreshed daily),
  shown in £ by default (converted from Cardmarket's euro prices), plus links to eBay sold listings.
- **Shop list** of every planned upgrade, sortable by set or rarity, a "Price check any card" search,
  and the list of still-missing Pokémon.
- **Card scanner:** a quick scan of one card (Claude Haiku 5.5) for a price check, or a binder page of up to 16 cards (Claude Sonnet 5.5) for cataloguing. Set-up steps are in [SCANNER.md](SCANNER.md).
- **Works offline** once opened (handy in shops), plus backup/restore to a file.
- **Optional sync** between the tablet and phones through a free Firebase project (set-up steps are in the app under Settings).

There's no build step: plain HTML/CSS/JS ES modules, with Preact + htm vendored in `vendor/`.

## Test version

The `test` branch is published at https://upgradex.jay-tuck1988.workers.dev/test/ as **UpgraDex Test**, which installs next to the real app and keeps its own data. Changes go to `test` first, then to `main` once they've been tried.

## Data sources

- Cards, images and prices: [TCGdex](https://tcgdex.dev) (free, no key).
- Pokédex names (EN/JP/KR): [PokéAPI](https://pokeapi.co), pre-built into `data/`.
- Currency rates: [Frankfurter](https://frankfurter.app).

Some cards have no picture on TCGdex. `data/extra-images.json` maps those to pictures on pokemontcg.io
(rebuild with `node scripts/build-extra-images.mjs`).

Japanese (and the few Korean) cards come from TCGdex's Japanese/Korean catalogues, indexed by Pokémon in
`data/cards-ja.json` / `data/sets-ja.json` (rebuild with `node scripts/build-intl.mjs`). They have their own
Cardmarket/TCGplayer prices.

To refresh `data/pokedex.json` and `data/sets.json` (e.g. when new sets or Pokémon come out):

```bash
node scripts/build-data.mjs
```

## Run locally

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080.

## Hosting

The app is static files only, served by a Cloudflare Worker. `.github/workflows/site.yml` rebuilds and publishes it
whenever `main` or `test` changes (it packs the files into the worker with `scripts/pack-site.py`; it needs the
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets the scanner also uses):

- **Real app** (from `main`): https://upgradex.jay-tuck1988.workers.dev/app/ (the site root forwards there, see `site-root/`).
- **UpgraDex Test** (from `test`): https://upgradex.jay-tuck1988.workers.dev/test/

The old GitHub Pages copy (https://jaygit88.github.io/UpgraDex/) is no longer updated; it's only there so a collection
saved on it can be backed up and moved across.

The two sit side by side rather than one inside the other, so Android never confuses the two installed apps.

When you change files, bump `VERSION` in `sw.js` so installed copies pick up the update.

Not affiliated with Nintendo, The Pokémon Company, Creatures or GAME FREAK.
