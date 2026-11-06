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

The `test` branch is published at https://jaygit88.github.io/UpgraDex/test/ as **UpgraDex Test**, which installs next to the real app and keeps its own data. Changes go to `test` first, then to `main` once they've been tried.

## Data sources

- Cards, images and prices: [TCGdex](https://tcgdex.dev) (free, no key).
- Pokédex names (EN/JP/KR): [PokéAPI](https://pokeapi.co), pre-built into `data/`.
- Currency rates: [Frankfurter](https://frankfurter.app).

Some cards have no picture on TCGdex. `data/extra-images.json` maps those to pictures on pokemontcg.io
(rebuild with `node scripts/build-extra-images.mjs`).

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

The app is static files only. `.github/workflows/pages.yml` publishes it to GitHub Pages whenever `main` or `test` changes
(one-off: repo *Settings → Pages → Source: GitHub Actions*):

- **Real app** (from `main`): https://jaygit88.github.io/UpgraDex/app/. The old address https://jaygit88.github.io/UpgraDex/ forwards there (see `site-root/`).
- **UpgraDex Test** (from `test`): https://jaygit88.github.io/UpgraDex/test/

The two sit side by side rather than one inside the other, so Android never confuses the two installed apps.

When you change files, bump `VERSION` in `sw.js` so installed copies pick up the update.

Not affiliated with Nintendo, The Pokémon Company, Creatures or GAME FREAK.
