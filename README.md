# Omnipad community layouts

Controller layouts for PC games, shared by players, rated with a thumbs up or down. Omnipad's layout picker
(PS / Guide + A in a game, or the Omnipad icon > Play > *Use a layout for this game*) shows them on its **Community** tab.

## Share a layout

1. In Omnipad, open the layout picker in your game, go to **Community** and choose **Share this game's layout**.
   GitHub opens with the file filled in. Check the `@title` and `@description` lines, then **Propose changes**.
   (Or put a file at `layouts/<game exe without .exe>/<name>.omnipad-layout` yourself.)
2. A check runs on your pull request (`node scripts/build-index.js validate`), then a maintainer reviews it.
3. Once merged, it shows up in Omnipad within a few hours.

Rules: one game per file; no game under an anti-cheat (`scripts/anticheat.txt` - Omnipad sends no keyboard / mouse
there); no system keys (Windows key, Ctrl+Alt+Del, Alt+Tab, Alt+F4...) or desktop actions; 16 KB at most; a title,
the game and the controller family (`xbox`, `playstation`, `switch` or `any`) in the `; @...:` lines.

## Rate or report one

Each layout has a "Rate: &lt;id&gt;" issue: react with :+1: or :-1: on its first post. *Rate it* in Omnipad opens it.
Something wrong? *Report it* in Omnipad opens a report issue.

---

## For the owner: publishing this repository

This folder is a template; nothing here is live until you publish it.

1. Create a **public** repository (for example `omnipad/community-layouts`) and push this folder's contents to its
   `main` branch. Keep blank issues enabled (Report links open one).
2. Settings > Actions > General: allow GitHub Actions; *Workflow permissions*: "Read and write".
3. Create the labels `rating` and `report` (Issues > Labels).
4. Run the **index** workflow once by hand (Actions > index > Run workflow). It uploads the layouts to a release
   tagged `layouts`, opens one rating issue per layout and commits `index.json`.
5. Point Omnipad at it: `[Community] Repo=<owner>/<name>` in omnipad.ini (the shipped default is the placeholder
   `omnipad/community-layouts`).
6. Protect `main` (require the **validate** check and one review) so nothing reaches players unreviewed.

| File | What it is |
| --- | --- |
| `layouts/<exe>/<name>.omnipad-layout` | the layouts (Omnipad's layout file + `; @key: value` lines) |
| `index.json` | generated - what Omnipad reads (do not edit) |
| `stats.json` | generated - download counts of replaced files |
| `scripts/build-index.js` | checks the files and builds the index (Node 18+, no packages) |
| `scripts/anticheat.txt` | games no layout may target (copy of Omnipad's list) |
| `.github/workflows/validate.yml` | the pull-request check (read-only) |
| `.github/workflows/index.yml` | rebuilds the index on merge and every 6 hours |

Local check: `node test/check.test.js && node scripts/build-index.js validate && node scripts/build-index.js build --offline`.

Costs: none on GitHub's free plan for a public repository (Actions minutes are free for public repositories; release
downloads and raw files are free). See Omnipad's docs/COMMUNITY_LAYOUTS.md for the limits and for moving to a server.
