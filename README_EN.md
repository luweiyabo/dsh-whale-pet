<div align="center">

<img src="https://raw.githubusercontent.com/luweiyabo/dsh-whale-pet/main/assets/plugin-logo.png" width="180" alt="dsh-whale-pet logo">

# dsh-whale-pet

Bring the whale pet into DeepSeek Harness: react to agent activity, respond to interaction, and roam around the screen.

[![npm version](https://img.shields.io/npm/v/%40luweiyabo%2Fdsh-whale-pet?style=flat-square&logo=npm&label=npm)](https://www.npmjs.com/package/@luweiyabo/dsh-whale-pet)
[![npm downloads](https://img.shields.io/npm/dm/%40luweiyabo%2Fdsh-whale-pet?style=flat-square&logo=npm&label=downloads)](https://www.npmjs.com/package/@luweiyabo/dsh-whale-pet)
[![GitHub stars](https://img.shields.io/github/stars/luweiyabo/dsh-whale-pet?style=flat-square&logo=github)](https://github.com/luweiyabo/dsh-whale-pet/stargazers)
[![GitHub issues](https://img.shields.io/github/issues/luweiyabo/dsh-whale-pet?style=flat-square&logo=github)](https://github.com/luweiyabo/dsh-whale-pet/issues)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/luweiyabo/dsh-whale-pet/blob/main/LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek_Harness-Web-2f81f7?style=flat-square)](https://github.com/deepseek-ai/deepseek-harness)
[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

[中文](https://github.com/luweiyabo/dsh-whale-pet/blob/main/README.md) · [Preview](#preview) · [Install](#installation) · [Usage](#usage) · [Features](#features) · [Development](#development) · [Issues](https://github.com/luweiyabo/dsh-whale-pet/issues)

</div>

dsh-whale-pet is an open-source desktop-pet plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It reacts to agent thinking, coding, tool calls, waiting states, and errors. It also supports click reactions, dragging, screen roaming, custom animations, event-triggered rules, balance/quota lookup, and turn notifications.

The package includes **95 transparent 640×360 WebM animations**, an interface in all eight languages Harness ships (Chinese, English, Japanese, Spanish, French, German, Russian, Portuguese), and settings that save automatically and take effect immediately.

## Preview

### Settings and action management

<table>
  <tr>
    <td align="center"><img src="https://raw.githubusercontent.com/luweiyabo/dsh-whale-pet/main/docs/images/screenshots/settings-overview.png" width="420" alt="Whale pet settings"><br><strong>Centralized settings</strong></td>
    <td align="center"><img src="https://raw.githubusercontent.com/luweiyabo/dsh-whale-pet/main/docs/images/screenshots/action-browser.png" width="420" alt="Browse and preview actions"><br><strong>Categories, search, and previews</strong></td>
  </tr>
  <tr>
    <td colspan="2" align="center"><img src="https://raw.githubusercontent.com/luweiyabo/dsh-whale-pet/main/docs/images/screenshots/custom-actions-and-rules.png" width="680" alt="Custom actions and event rules"><br><strong>Custom actions and trigger rules</strong></td>
  </tr>
</table>

### Desktop interaction and status

<table>
  <tr>
    <td align="center"><img src="https://raw.githubusercontent.com/luweiyabo/dsh-whale-pet/main/docs/images/screenshots/click-to-move.png" width="300" alt="Click to move the pet"><br><strong>Click to move</strong></td>
    <td align="center"><img src="https://raw.githubusercontent.com/luweiyabo/dsh-whale-pet/main/docs/images/screenshots/context-menu.png" width="300" alt="Pet context menu"><br><strong>Context menu</strong></td>
    <td align="center"><img src="https://raw.githubusercontent.com/luweiyabo/dsh-whale-pet/main/docs/images/screenshots/balance-bubble.png" width="300" alt="Account balance bubble"><br><strong>Balance bubble</strong></td>
  </tr>
  <tr>
    <td colspan="3" align="center"><img src="https://raw.githubusercontent.com/luweiyabo/dsh-whale-pet/main/docs/images/screenshots/i18n.png" width="680" alt="Multilingual interface"><br><strong>Multilingual UI (8 languages)</strong></td>
  </tr>
</table>

See the [complete gallery of all 95 actions](https://github.com/luweiyabo/dsh-whale-pet/blob/main/README.md#动作展示).

## Installation

### Requirements

| Item | Requirement |
|---|---|
| DeepSeek Harness | `^0.1.0-rc.6 \|\| ^0.1.2-rc.1 \|\| ^0.2.0-rc.2 \|\| ^0.2.2-rc.1` (developer preview; Web profile) |
| Node.js | `^22.19.0 \|\| >=24.0.0` (follows DSH's official `engines.node`) |
| pnpm | Available on the command line; `dsh plugin` delegates package management to pnpm |

The plugin loads as DSH's Web client; the Web and desktop apps share the same client. The commands below use the `web` profile.

### Install from npm

```sh
dsh plugin --profile web add @luweiyabo/dsh-whale-pet
dsh web
```

The pet appears in the lower-right corner by default.

Alternatively, install directly from GitHub:

```sh
dsh plugin --profile web add github:luweiyabo/dsh-whale-pet
```

Keep only one installation source in a Web profile. Before switching between the npm, GitHub, and local-checkout variants, uninstall the current variant; otherwise multiple packages declare the same `whale-pet` loader entry and DSH cannot start.

### Install from desktop

DSH Desktop keeps its own `desktop` profile, independent of the Web profile, and can install the plugin directly (only one installation source may exist in a profile):

1. Open DSH Desktop and go to the **Plugins** page in the left sidebar.
2. Click **Add plugin** and enter `@luweiyabo/dsh-whale-pet` under "Package name or address" (a GitHub repository address or local directory path also works).
3. Enable it when prompted after installation; if DSH asks for a restart, fully quit and reopen DSH Desktop — the pet appears in the lower-right corner.

The same Plugins page also updates, disables, and uninstalls installed plugins; restart when prompted after an update.

> If the `dsh` CLI is installed, you can instead fully quit Desktop and run `dsh plugin --profile desktop add @luweiyabo/dsh-whale-pet` (the desktop profile must have been initialized once by launching the app).

### Install from a local checkout

```sh
dsh plugin --profile web add .
```

### Update

```sh
dsh plugin --profile web update @luweiyabo/dsh-whale-pet
```

### Uninstall

```sh
dsh plugin --profile web remove @luweiyabo/dsh-whale-pet
```

Restart `dsh web` after uninstalling. User-uploaded actions remain in `$DSH_HOME/whale-pet/actions/` and are not removed automatically.

## Development

Client source lives in `src/client/`: `animations.js` owns the animation catalog, `activity.js` owns events, rules and arbitration, `notify.js` decides notification channels (bubble / system notification / chime), `balance-alert.js` owns money and balance/quota alert state, `schedule.js` owns calendar and usage formatting, `host-api.js` adapts to different hosts, and `index.js` owns the UI and player. The host side lives in `lib/index.js` (settings schema, asset routes, balance/quota queries) and `lib/balance-*.js` (source classification and wallet/quota parsing). Run `npm run build` after editing source and commit the generated `lib/client.js` alongside it. `npm run check` verifies that the bundle matches the source. React is still supplied by DSH.

```sh
git clone https://github.com/luweiyabo/dsh-whale-pet.git
cd dsh-whale-pet
npm ci
npm run build
dsh plugin --profile web add .
dsh web
```

Run tests and inspect the npm package contents:

```sh
npm run check
npm run format:check
npm test
npm pack --dry-run
```

The project uses DSH's split host/client plugin architecture:

- [`lib/index.js`](https://github.com/luweiyabo/dsh-whale-pet/blob/main/lib/index.js): host-side settings, static animations, custom actions, model API, and balance/quota API
- [`lib/balance-source.js`](https://github.com/luweiyabo/dsh-whale-pet/blob/main/lib/balance-source.js): balance-source classification and error diagnostics (host-side pure functions)
- [`lib/balance-quota.js`](https://github.com/luweiyabo/dsh-whale-pet/blob/main/lib/balance-quota.js): plan-quota queries for Codex / OpenCode Go / GLM Coding
- [`lib/balance-providers.js`](https://github.com/luweiyabo/dsh-whale-pet/blob/main/lib/balance-providers.js), [`lib/deepseek-balance.js`](https://github.com/luweiyabo/dsh-whale-pet/blob/main/lib/deepseek-balance.js): wallet balance endpoints and response parsing
- [`lib/client.js`](https://github.com/luweiyabo/dsh-whale-pet/blob/main/lib/client.js): browser-side playback, interaction, intent arbitration, and settings UI
- [`cordis.patch.yml`](https://github.com/luweiyabo/dsh-whale-pet/blob/main/cordis.patch.yml): DSH bundle registration
- [`assets/plugin-logo.png`](https://github.com/luweiyabo/dsh-whale-pet/blob/main/assets/plugin-logo.png): plugin logo
- [`assets/thumb/`](https://github.com/luweiyabo/dsh-whale-pet/tree/main/assets/thumb): built-in transparent animations
- [`docs/images/screenshots/`](https://github.com/luweiyabo/dsh-whale-pet/tree/main/docs/images/screenshots): README feature-preview screenshots
- [`docs/images/actions/`](https://github.com/luweiyabo/dsh-whale-pet/tree/main/docs/images/actions): low-frame-rate GIF previews for all 95 actions
- [`materials/references/`](https://github.com/luweiyabo/dsh-whale-pet/tree/main/materials/references): character first frames and visual references
- [`materials/videos/`](https://github.com/luweiyabo/dsh-whale-pet/tree/main/materials/videos): AI-generated source MP4 files for traceability and reprocessing, not runtime playback
- [`materials/prompts/`](https://github.com/luweiyabo/dsh-whale-pet/tree/main/materials/prompts): animation-generation prompts

Contributions are welcome through [issues](https://github.com/luweiyabo/dsh-whale-pet/issues) and [pull requests](https://github.com/luweiyabo/dsh-whale-pet/pulls). Run the tests before submitting and never commit API keys, private configuration, or large source videos.

## Usage

### Basic interaction

| Action | Result |
|---|---|
| Hover | The pet faces the pointer side and restores its previous direction on leave; disabled while dragging or coasting |
| Hover (effects) | The pet leans subtly toward a nearby cursor; can be disabled in settings |
| Single-click the pet | Plays a head, body, or tail reaction and toggles selection; when interactive effects are enabled, each click also triggers a Q-style squash-and-bounce effect; while selected, click the page to choose a destination |
| Double-click the pet | Plays the “Blue Whale Appears” special animation and clears selection |
| Drag and bounce | Moves and places the pet; squash-and-stretch follows drag speed, and a quick throw starts the “Turn Into a Ball” animation at its ball-shaped frame and continues with momentum; the character bounds bounce off screen edges, collisions add a Q-style squash when interactive effects are enabled; momentum is disabled when Reduce Motion is enabled |
| Drag fully off-screen | Enters edge-hidden mode; move the pointer to that screen edge to reveal the recall handle |
| Right-click | Opens shortcuts for Home, Refresh balance, Settings, and Hide; a “Back to finished session” entry appears for about 2 minutes after the latest done/needs-input bubble was shown in this page |

### Settings

Open **Plugins → Whale Pet** (or right-click the pet and pick "Settings", which switches to the Plugins panel and opens this row's Configure page) to configure:

- Visibility, text bubbles, balance display, balance alerts, and turn notifications (balance alerts and turn notifications each have one switch; thresholds, refresh interval, API-key permission, turn-end refresh, and weekly/monthly quota thresholds are config-file only)
- Interactive effects (cursor tilt-follow, click bounce, drag squash)
- Pet size, default corner, and session-awareness scope
- Quiet, balanced, or lively autonomous activity
- Calendar awareness (always enabled; no switch in the settings page): festival and seasonal animations are preferred only in their window; if the configured pool has no in-season animation, the full pool is used instead of an empty one
- Animations for working, coding, reading, researching, thinking, waiting, listening, and error states
- Autonomous, movement, and click-reaction pools
- Custom action upload, preview, and deletion
- Custom event-triggered rules

Changes made in the settings page are saved and applied automatically; balance parameters in the config file take effect after restarting DSH.

## Features

### Agent-aware animations

The pet reads Harness session activity and selects suitable actions through nine configurable intent arbiters:

| Harness activity | Default behavior |
|---|---|
| Coding or file operations | Coding at a computer |
| Thinking and reasoning | Deep thought |
| Reading and research | Taking notes |
| Waiting for approval or an answer | Looking around |
| User message | Attentive listening |
| Tool or agent error | Startled reaction |
| No activity | Idle, turn, random action, or roam |

Debounce and linger intervals prevent rapid animation switching. User interaction, errors, and other high-priority events can interrupt the current animation.

### Autonomous behavior and roaming

- Continuous autonomous animation chain while no session event is active
- Default probabilities: idle 30%, turn 10%, action 40%, movement 20%
- Direction-aware movement with available-space checks
- Relative position persistence across window resizing
- Double-buffered video crossfades
- Interactive effects layer: cursor tilt-follow (rAF spring), click bounce, drag squash-and-stretch, and bouncy squash during coasting/bounces, globally toggleable
- Support for `prefers-reduced-motion`
- Calendar awareness (always on): festival animations appear only around their dates (Gregorian and Chinese lunar; leap months are handled correctly and the result is timezone-independent); seasonal animations only in their season. If the pool has no suitable animation, the full pool is used instead of an empty one
- A static transparent first-frame poster covers cold starts until the first video is ready
- Background tabs pause video playback; when balance alerts are on, balance/quota polling is throttled to a 5-minute floor, otherwise background polling stops; only one pet per browser (other tabs step aside; when `localStorage` is unavailable, every tab shows a pet and no single-instance coordination happens)
- The dragged position is remembered across reloads, restarts, and hide/show cycles (right-click Home clears it)

### Custom trigger rules

- Built-in templates for tool calls, failures, agent errors, turn completion, and approval requests
- Multiple conditions per rule
- Configurable priority, cooldown, and hold duration
- Test-trigger action and last-triggered status
- Shared priority arbitration with built-in intents
- Local `time` (`HH:MM`) and `dayOfWeek` (`0` = Sunday) conditions plus greater-than / less-than operators for work-hours and weekend rules

### Account balance and low-balance alerts

Turn on **Show balance** to display the balance and **Balance alert** to be notified when the wallet or plan quota runs low. Sources are chosen in this order; API-key wallets are queried by default:

- **DeepSeek account** (signed in): uses the DSH account service `remote.account.getBalance`; no API key. The amount is recharge + bonus.
- **Plans / subscriptions** (Kimi Coding, GLM Coding, Qwen / Xiaomi Token Plan, ChatGPT Codex, GitHub Copilot, etc.): reports "plan/subscription billing — no wallet balance" and never queries a wallet; see the plan-quota row below for quota queries.
- **Plan quota**: Codex reads local logs (5h/week; reads local logs only, offline); OpenCode Go queries its official endpoint (5h/week/month); GLM Coding CN and z.ai intl query their official endpoints (5h/week). When available, the bubble shows "5h 62% · week 31%" and the detail card shows bars plus reset countdowns. No fake numbers when an endpoint is unavailable. Only official provider baseURLs are used for quota; a custom baseURL is treated as unsupported and no key is sent. Quota reads that access the network use the API key by default (Codex needs none); a weekly/monthly window alerts once when 5% or less remains, and the 5h window never alerts. Missing windows are not fabricated.
- **API-key wallets** (DeepSeek / Moonshot / StepFun): queried by default. The key stays in the Host and is sent only to the provider's official balance endpoint. Unknown routes are not guessed, and a custom baseURL is treated as unsupported with no key sent.

Low-balance alerts:

- Default thresholds CNY 5 / USD 1; one alert per crossing, reset after topping up.
- Weekly/monthly plan quota alerts by default when 5% or less remains; resets after recovery. The 5h window is not alerted.
- Channel: **system notification first** — crossing the threshold sends a system notification even while the page is focused (a bubble alone is easy to miss), and the in-page bubble is kept too; when system notifications are unavailable, an unfocused page gets the chime plus a title dot and a focused page gets the bubble. If a focused system notification fails to send, the page falls back to the bubble.
- Default 60 s refresh interval; right-click "Refresh balance" queries the balance and plan quota immediately (3 s Host floor); the current session refreshes once when a turn ends.
- Opening a session detects its model automatically and fetches the balance without waiting for a model request; the bubble shows "Detecting the session model…" while resolving.
- Hover the balance bubble to expand the detail and move away to collapse it: source, currencies, and last update; changed amounts roll with reduced-motion support. Refresh and settings remain in the right-click menu.
- Proxy: DSH reads `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY` at launch; the plugin uses plain `fetch` and never installs its own proxy. OS proxy settings are not read; SOCKS is unsupported; a TLS-intercepting proxy needs `NODE_EXTRA_CA_CERTS` before launch.
- Low-balance alerts are on by default; among balance settings, only the balance-alert switch is exposed in the settings page, while the other parameters are editable in the profile `cordis.patch.yml` under `whale-pet.config.balance`: `thresholds.CNY/USD` (default 5 / 1), `refreshMs` (default 60000), `allowApiKey` (default true), `turnRefresh` (default true), `timeoutMs` (default 12000), `quotaAlert.weeklyPct/monthlyPct` (default 5) (restart to apply).

### Turn notifications

Get notified when a turn finishes, fails, or waits for your approval/answer. There are exactly three channels: an in-page bubble, a system notification while the page is not visible/focused, and a chime plus a title dot when system notifications are unavailable.

- Page focused: a bubble above the pet with a reaction animation; in-page notifications are bubbles only (the old notification card and queue have been removed); other sessions include their name, and clicking the bubble switches back
- Page unfocused/minimized: system notification on Windows, macOS, and Linux (grant browser permission once on the Web; none needed in Desktop)
- No system notification available: a short chime plus a `●` title marker (also when permission was denied, the context is insecure, or `Notification` is missing); no card is back-filled when you return
- One “Turn notifications” checkbox under Display & behavior: it covers completion, failure, and needs-input; system notifications versus the chime is decided by the environment
- Subagent sessions never notify: a subagent is a separate child session, so its completion/failure only drives pet animations — no bubble, system notification, or chime
- Background sessions are watched regardless of the activity scope, so switching away does not lose the completion

## Action configuration

See the [complete gallery of all 95 actions](https://github.com/luweiyabo/dsh-whale-pet/blob/main/README.md#动作展示) for all built-in actions. The action selector follows the Harness language and shows names in the current UI language, with search by category, English ID, or name (current UI language, Chinese, and English are searched); both built-in and user-uploaded actions can join autonomous pools, bind to event intents, or be used in trigger rules.

## Custom actions

Upload a `.webm` or `.mp4` file in the settings card, or copy it to:

```text
$DSH_HOME/whale-pet/actions/
```

Recommended format:

| Item | Requirement |
|---|---|
| Canvas | 640×360 |
| Background | Transparent |
| Foot line | y=330 |
| Format | WebM or MP4 |
| Upload limit | 64 MiB per file |
| Total custom storage | 512 MiB |
| Action ID | Filename; Unicode is supported and existing files are not overwritten |

Uploaded actions appear under the “Custom” category and can be added to autonomous pools, assigned to intents, or selected by trigger rules.

Before uploading, the video metadata is read and possible problems are flagged: MP4 has no alpha channel (black background), non-16:9 framing (misaligned footprint and hit box), longer than 15 s, or unreadable metadata. These are advisory only and never block the upload.

## Configuration and data

Settings are stored in the DSH `whale-pet` namespace. Custom animations are stored in `$DSH_HOME/whale-pet/actions/`. The plugin does not upload animations, settings, or API keys to the project maintainer.

The settings page title, description, row summary, and all field copy follow the Harness UI language and update immediately when the language changes.

| Environment variable | Purpose |
|---|---|
| `DSH_HOME` | Overrides the DSH data directory |
| `DEEPSEEK_API_KEY` | One credential source for DeepSeek wallet balance queries |
| `MOONSHOT_API_KEY` | One credential source for Moonshot wallet balance queries |
| `STEPFUN_API_KEY` | One credential source for StepFun wallet balance queries |
| `CODEX_HOME` | Codex local session-log directory (used for plan quota); defaults to `~/.codex` |
| `ZAI_API_KEY` | One credential source for z.ai (GLM Coding international) quota queries |
| `ZAI_CODING_CN_API_KEY` | One credential source for GLM Coding CN (Zhipu) quota queries |
| `OPENCODE_API_KEY` | One credential source for OpenCode Go quota queries |

Credentials are read from DSH's credential service first and then from the environment variable of the same name; wallets and plan quotas also prefer the provider's configured `apiKeyEnv` reference.

## Troubleshooting

<details>
<summary><strong>The pet does not appear after installation</strong></summary>

Restart `dsh web`, then open **Plugins → Whale Pet** and ensure the pet is enabled. You can also run `dsh --profile web --dump-config` and confirm the plugin appears in the merged configuration.

</details>

<details>
<summary><strong>The pet disappeared after being dragged off-screen</strong></summary>

Move the pointer to the screen edge where it disappeared. You can also enable it again in settings or use **Home** from the context menu.

</details>

<details>
<summary><strong>The balance bubble says unsupported or failed</strong></summary>

A plan/subscription provider showing “plan/subscription billing” is expected; an API-key wallet showing “needs permission” means querying was disabled in the config file — set `whale-pet.config.balance.allowApiKey: true` in the profile `cordis.patch.yml` and restart (it is on by default). For network/proxy errors, check `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY` at DSH launch; a TLS-intercepting proxy also needs `NODE_EXTRA_CA_CERTS`.

</details>

<details>
<summary><strong>My custom action plays with a black background</strong></summary>

MP4 (H.264) has no alpha channel, so the pet renders as a black box. Use a WebM with alpha (VP9 + `yuva420p`) instead — the upload warning reports the same reason.

</details>

<details>
<summary><strong>Right-click → Settings does nothing in the desktop app</strong></summary>

Both platforms behave the same: the pet uses the official layout API to open the Plugins panel and
then clicks the Configure control on its own row (the host labels it `Configure <name>`), which opens the
plugin configuration page directly. If another detail page is open, it goes back to the list first. Only
when that fails does it show a hint. Older 0.1.x shells keep the legacy Settings → Plugins path.

</details>

<details>
<summary><strong>Why is there only one pet when I open several DSH tabs?</strong></summary>

The plugin keeps a single instance with a `localStorage` heartbeat: only the tab holding it renders the pet, other tabs stand by (their settings card still works). After the leading tab closes or reloads, another tab takes over within seconds. When `localStorage` is unavailable (for example some privacy modes) no coordination happens: every tab shows the pet and there is no takeover.

</details>

<details>
<summary><strong>Why is the pet static in Safari?</strong></summary>

Safari (and every browser on iOS) runs on WebKit, which ignores the VP9 alpha channel and shows the video on a black box. When the plugin detects such an environment it uses a still frame extracted from each animation: the black box is gone, but only static poses remain. Use a Chromium-based browser or the desktop app for frame-by-frame animation.

</details>

## Asset sources and licensing

- Original source code is licensed under the [MIT License](https://github.com/luweiyabo/dsh-whale-pet/blob/main/LICENSE).
- Most animations under [`assets/thumb/`](https://github.com/luweiyabo/dsh-whale-pet/tree/main/assets/thumb) come from [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) and are not covered by this project's MIT code license.
- The upstream project currently allows these assets in open-source projects but prohibits commercial use. Review the [third-party asset notice](https://github.com/luweiyabo/dsh-whale-pet/blob/main/THIRD_PARTY_ASSETS_EN.md) and the latest upstream terms before use, redistribution, or modification.
- Because the npm package combines MIT-licensed code with separately licensed media, its package license is `SEE LICENSE IN LICENSE` rather than plain `MIT`. The root [LICENSE](https://github.com/luweiyabo/dsh-whale-pet/blob/main/LICENSE) (standard MIT) covers only original code; the media terms are in the [third-party asset notice](https://github.com/luweiyabo/dsh-whale-pet/blob/main/THIRD_PARTY_ASSETS_EN.md) shipped with the package. The complete package must not be treated as purely MIT-licensed.

This is an independent community plugin and is not affiliated with DeepSeek.
