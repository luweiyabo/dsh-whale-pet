<div align="center">

<img src="https://raw.githubusercontent.com/luweiyabo/dsh-whale-pet/main/assets/plugin-logo.png" width="180" alt="dsh-whale-pet logo">

# dsh-whale-pet

Bring the whale girl into DeepSeek Harness: react to agent activity, respond to interaction, and roam around the screen.

[![npm version](https://img.shields.io/npm/v/%40luweiyabo%2Fdsh-whale-pet?style=flat-square&logo=npm&label=npm)](https://www.npmjs.com/package/@luweiyabo/dsh-whale-pet)
[![npm downloads](https://img.shields.io/npm/dm/%40luweiyabo%2Fdsh-whale-pet?style=flat-square&logo=npm&label=downloads)](https://www.npmjs.com/package/@luweiyabo/dsh-whale-pet)
[![GitHub stars](https://img.shields.io/github/stars/luweiyabo/dsh-whale-pet?style=flat-square&logo=github)](https://github.com/luweiyabo/dsh-whale-pet/stargazers)
[![GitHub issues](https://img.shields.io/github/issues/luweiyabo/dsh-whale-pet?style=flat-square&logo=github)](https://github.com/luweiyabo/dsh-whale-pet/issues)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/luweiyabo/dsh-whale-pet/blob/main/LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek_Harness-Web-2f81f7?style=flat-square)](https://github.com/deepseek-ai/deepseek-harness)
[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

[中文](https://github.com/luweiyabo/dsh-whale-pet/blob/main/README.md) · [Preview](#preview) · [Install](#installation) · [Usage](#usage) · [Features](#features) · [Development](#development) · [Issues](https://github.com/luweiyabo/dsh-whale-pet/issues)

</div>

dsh-whale-pet is an open-source desktop-pet plugin for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web UI. It reacts to agent thinking, coding, tool calls, waiting states, and errors. It also supports click reactions, dragging, screen roaming, custom animations, and event-triggered rules.

The package includes **95 transparent 640×360 WebM animations**, a Chinese and English interface, and settings that save automatically and take effect immediately.

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
    <td colspan="3" align="center"><img src="https://raw.githubusercontent.com/luweiyabo/dsh-whale-pet/main/docs/images/screenshots/i18n.png" width="680" alt="Chinese and English interface"><br><strong>Chinese and English UI</strong></td>
  </tr>
</table>

See the [complete gallery of all 95 actions](https://github.com/luweiyabo/dsh-whale-pet/blob/main/README.md#动作展示).

## Installation

### Requirements

| Item | Requirement |
|---|---|
| DeepSeek Harness | `^0.1.0-rc.6 \|\| ^0.1.2-rc.1` (developer preview; Web profile) |
| Node.js | `^22.19.0 \|\| >=24.0.0` (follows DSH's official `engines.node`) |
| pnpm | Available on the command line; `dsh plugin` delegates package management to pnpm |

Supports DSH `0.1.2-rc.1` configuration RPC, session events, model selection, and pending approvals/questions while retaining the legacy `connection.api` path. The new adapter reads the current session from the host service and restores state after reconnecting without firing rules for historical messages. Balances still come from official provider endpoints; missing credentials produce a query failure.

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

- [`lib/index.js`](https://github.com/luweiyabo/dsh-whale-pet/blob/main/lib/index.js): host-side settings, static animations, custom actions, and balance API
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
| Right-click | Opens shortcuts for Home, Settings, and Hide |

### Settings

Open **Settings → Plugins → Whale Pet** to configure:

- Visibility, text bubbles, and account-balance bubbles
- Interactive effects (cursor tilt-follow, click bounce, drag squash)
- Pet size, default corner, and session-awareness scope
- Quiet, balanced, or lively autonomous activity
- Animations for working, coding, reading, researching, thinking, waiting, listening, and error states
- Autonomous, movement, and click-reaction pools
- Custom action upload, preview, and deletion
- Custom event-triggered rules

Settings are saved automatically and applied without restarting.

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

### Custom trigger rules

- Built-in templates for tool calls, failures, agent errors, turn completion, and approval requests
- Multiple conditions per rule
- Configurable priority, cooldown, and hold duration
- Test-trigger action and last-triggered status
- Shared priority arbitration with built-in intents

### Account-balance bubble

When `meter` is enabled, the plugin detects the provider used by the current session and displays the balance returned by that provider's official API. It does not estimate token costs.

- Reads the current Harness model configuration, credential store, and provider default environment variables
- Supports `DEEPSEEK_API_KEY`, `MOONSHOT_API_KEY`, and `STEPFUN_API_KEY`, plus provider-specific `apiKeyEnv` settings
- Sends a provider key only to that provider's allowlisted official endpoint, from the local host process
- Disabled by default
- Gracefully reports unsupported providers

## Action configuration

See the [complete gallery of all 95 actions](https://github.com/luweiyabo/dsh-whale-pet/blob/main/README.md#动作展示) for all built-in actions. The action selector follows the Harness language and shows Chinese or English names, with search by category, English ID, or name; both built-in and user-uploaded actions can join autonomous pools, bind to event intents, or be used in trigger rules.

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

## Configuration and data

Settings are stored in the DSH `whale-pet` namespace. Custom animations are stored in `$DSH_HOME/whale-pet/actions/`. The plugin does not upload animations, settings, or API keys to the project maintainer.

| Environment variable | Purpose |
|---|---|
| `DSH_HOME` | Overrides the DSH data directory |
| `DEEPSEEK_API_KEY` | One credential source for DeepSeek balance queries |
| `MOONSHOT_API_KEY` | One credential source for Moonshot balance queries |
| `STEPFUN_API_KEY` | One credential source for StepFun balance queries |

## Troubleshooting

<details>
<summary><strong>The pet does not appear after installation</strong></summary>

Restart `dsh web`, then open **Settings → Plugins → Whale Pet** and ensure the pet is enabled. You can also run `dsh --profile web --dump-config` and confirm the plugin appears in the merged configuration.

</details>

<details>
<summary><strong>The pet disappeared after being dragged off-screen</strong></summary>

Move the pointer to the screen edge where it disappeared. You can also enable it again in settings or use **Home** from the context menu.

</details>

<details>
<summary><strong>The balance bubble says unsupported or failed</strong></summary>

Check whether the current model provider exposes a public balance API and whether the relevant Harness credential or environment variable is configured. Unsupported providers fall back safely.

</details>

## Asset sources and licensing

- Original source code is licensed under the [MIT License](https://github.com/luweiyabo/dsh-whale-pet/blob/main/LICENSE).
- Most animations under [`assets/thumb/`](https://github.com/luweiyabo/dsh-whale-pet/tree/main/assets/thumb) come from [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) and are not covered by this project's MIT code license.
- The upstream project currently allows these assets in open-source projects but prohibits commercial use. Review the [third-party asset notice](https://github.com/luweiyabo/dsh-whale-pet/blob/main/THIRD_PARTY_ASSETS_EN.md) and the latest upstream terms before use, redistribution, or modification.
- Because the npm package combines MIT-licensed code with separately licensed media, its package license is `SEE LICENSE IN LICENSE` rather than plain `MIT`. The root [LICENSE](https://github.com/luweiyabo/dsh-whale-pet/blob/main/LICENSE) (standard MIT) covers only original code; the media terms are in the [third-party asset notice](https://github.com/luweiyabo/dsh-whale-pet/blob/main/THIRD_PARTY_ASSETS_EN.md) shipped with the package. The complete package must not be treated as purely MIT-licensed.

This is an independent community plugin and is not affiliated with DeepSeek.
