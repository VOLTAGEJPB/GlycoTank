# GlycoTank

A private, offline nutrition and training tracker for iPhone and Android.
Log meals and workouts and GlycoTank estimates your glycogen "fuel tank",
suggests carbs for tomorrow's training, and scores your readiness from a
quick morning check-in. No accounts and no servers: data stays on the device.

## How it's built

- Plain JavaScript + [Vite](https://vite.dev), wrapped as a native app with
  [Capacitor 8](https://capacitorjs.com).
- `src/model.js`: all the math (glycogen tank, carb planner, readiness,
  personalized targets, plate math, meal quick-entry parsing). It has no
  DOM or storage dependencies and is covered by `test/model.test.js`.
- `src/store.js`: saves state to Capacitor Preferences on devices (or
  localStorage in a browser), and imports data from the original app.
- `src/views/`: one file per screen (Today, Log, Check-in, History, Settings).
- `src/native.js`: share-sheet export and daily reminder notifications.
- `legacy/`: the original 2025 prototype, kept for reference.

## Commands

```sh
npm install
npm test          # unit tests for the model
npm run dev       # run in a browser; add ?demo to load sample data
npm run build     # production web build into dist/
npm run sync      # build and copy into the native projects (after `npx cap add android|ios`)
```

## The glycogen model

Each day starts where the previous one ended (70% of capacity before the
first entry). Meals add carbs × uptake% (default 85%). Training uses a fixed
amount per hard set (6 g) and per cardio minute (0.33 g × intensity 1–5).
Everyday use (150 g/day at a full tank) scales with how full the tank is,
so the level settles where it matches the diet. The tank is capped between
empty and its capacity. All values are adjustable in Settings and set
automatically by Personalize. These are general estimates, not medical
measurements.
