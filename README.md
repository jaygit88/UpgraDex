# Dex Upgrades

A web app (installable on a tablet or phone) for a one-of-each Pokédex card collection:

- **Pokédex grid** of all 1,025 Pokémon showing the card owned for each, with the missing ones highlighted.
- **Pick the exact card** from every printed card of that Pokémon, with pictures, set, number and rarity
  (Pokémon TCG Pocket cards are left out).
- **Language tag** (EN / JP / KR) on each card, so each card appears once instead of three times.
- **Up to 3 ranked upgrades** per Pokémon, with "Got it!" to promote an upgrade to the owned card (with undo).
- **Typical recent price** for every card (Cardmarket 30-day average and TCGplayer market price, refreshed daily),
  optionally converted to £/€/$, plus links to eBay sold listings.
- **Shop list** of every planned upgrade, sortable by set or rarity, a "Price check any card" search,
  and the list of still-missing Pokémon.
- **Works offline** once opened (handy in shops), plus backup/restore to a file.
- **Optional sync** between the tablet and phones through a free Firebase project (set-up steps are in the app under Settings).

There's no build step: plain HTML/CSS/JS ES modules, with Preact + htm vendored in `vendor/`.

## Data sources

- Cards, images and prices: [TCGdex](https://tcgdex.dev) (free, no key).
- Pokédex names (EN/JP/KR): [PokéAPI](https://pokeapi.co), pre-built into `data/`.
- Currency rates: [Frankfurter](https://frankfurter.app).

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

The app is static files only, so any static host works:

- **GitHub Pages:** `.github/workflows/pages.yml` deploys on every push to `main`. In the repo go to
  *Settings → Pages → Source: GitHub Actions*. Pages on a **private** repo needs a paid GitHub plan;
  otherwise make the repo public (it contains no secrets) or use one of the hosts below.
- **Netlify / Cloudflare Pages:** connect the repo (private repos are fine on their free plans), with no build command and the repo root as the publish directory.

When you change files, bump `VERSION` in `sw.js` so installed copies pick up the update.

Not affiliated with Nintendo, The Pokémon Company, Creatures or GAME FREAK.
