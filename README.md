# Shade

A daily logic puzzle about trees, sunlight and picnic blankets.

## Rules

1. Place exactly one tree in every row, every column and every colored region.
2. Each tree casts a diagonal shadow away from the sun. It runs through the rest of its own region, spills into the next region, and stops at that region's edge.
3. No tree may stand in another tree's shadow.
4. Every picnic blanket must end up in shade.

The sun moves through the week (Mon top-left, Tue top-right, Wed bottom-right, Thu bottom-left, Fri top-left); weekends have two suns.

## Development

```sh
npm install
npm run dev      # http://localhost:5173 (also on your LAN for phone testing)
npm test
npm run build    # static site in dist/
```

Puzzles are generated in the browser from the date, so everyone gets the same daily board with no server. `src/core` holds the engine (shadows, solver, generator); `src/main.ts` is the UI. In dev, `#reveal=k` pre-places the first k solution trees.
