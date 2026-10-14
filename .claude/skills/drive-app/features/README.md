# BeanQuery feature map

The recipes [the drive-app skill](../SKILL.md) runs: what each feature is for a user, how to reach it, how to drive it, and what proves it works. Read this index, then the file for each feature your change touches.

## Baseline
- A run launched and seeded as the skill says: BeanQuery at `http://127.0.0.1:3077`, roasters Nord Kaffe and Tanat, one admin account with 4 bags (Ethiopia Sasaba, Peru La Danta, two Panamas), and `$RUN/paste-one-bag.json` holding a fifth (Tanat, Ethiopia - Elto [Hamasho 72h]).
- Signed in, except for [sign-in](sign-in.md) itself.
- Recipes that change data say so; run them after the read-only ones, or note the changed baseline.

## Each feature file
An H1 and one paragraph on what the user sees, then four sections in order: `Sub-features`, `How to get to it (user POV)`, `Driving it with the built-in browser` (starting with `Preconditions:`, then each user action with its exact step and the result to see), and `Gotchas`. A recipe that can't be driven reports the unmet precondition; it is never weakened to pass.

## Features
- [Sign in](sign-in.md): the account number gets you into the library.
- [Paste a bag](paste-a-bag.md): pasted JSON is checked, previewed and saved as a bag with its plan. Changes data.
- [Library search](library-search.md): typing in the library's search narrows the list without a reload.
- [Theme](theme.md): System, Light or Dark on the account page, saved as it is picked. Changes data.
- [Stats](stats.md): the world map, rankings and charts over the account's own bags.

Not mapped yet: the pool and a coffee's page, roasters with notes, gear, edit and repaste, bag state and rating, export and import, redeeming an invite, admin. Add a file when a change touches one.
