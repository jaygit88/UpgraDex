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

The app is static files only. `.github/workflows/pages.yml` publishes it to GitHub Pages on every push to `main`
(one-off: repo *Settings → Pages → Source: GitHub Actions*). It will be at https://jaygit88.github.io/pokeapp/.

When you change files, bump `VERSION` in `sw.js` so installed copies pick up the update.

Not affiliated with Nintendo, The Pokémon Company, Creatures or GAME FREAK.
