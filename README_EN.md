<div align="center">

<img src="https://raw.githubusercontent.com/luweiyabo/dsh-whale-pet/main/assets/plugin-logo.png" width="180" alt="dsh-whale-pet logo">

# dsh-whale-pet

Bring the whale girl into DeepSeek Harness: react to agent activity, respond to interaction, and roam around the screen.

[![npm version](https://img.shields.io/npm/v/%40luweiyabo%2Fdsh-whale-pet?style=flat-square&logo=npm&label=npm)](https://www.npmjs.com/package/@luweiyabo/dsh-whale-pet)
[![npm downloads](https://img.shields.io/npm/dm/%40luweiyabo%2Fdsh-whale-pet?style=flat-square&logo=npm&label=downloads)](https://www.npmjs.com/package/@luweiyabo/dsh-whale-pet)
[![GitHub stars](https://img.shields.io/github/stars/luweiyabo/dsh-whale-pet?style=flat-square&logo=github)](https://github.com/luweiyabo/dsh-whale-pet/stargazers)
[![GitHub issues](https://img.shields.io/github/issues/luweiyabo/dsh-whale-pet?style=flat-square&logo=github)](https://github.com/luweiyabo/dsh-whale-pet/issues)
[![License](https://img.shields.io/github/license/luweiyabo/dsh-whale-pet?style=flat-square)](./LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek_Harness-Web-2f81f7?style=flat-square)](https://github.com/deepseek-ai/deepseek-harness)

[中文](./README.md) · [Preview](#preview) · [Install](#installation) · [Usage](#usage) · [Features](#features) · [Development](#development) · [Issues](https://github.com/luweiyabo/dsh-whale-pet/issues)

</div>

dsh-whale-pet is an open-source desktop-pet plugin for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web UI. It reacts to agent thinking, coding, tool calls, waiting states, and errors. It also supports click reactions, dragging, screen roaming, custom animations, and event-triggered rules.

The package includes **94 transparent 640×360 WebM animations**, a Chinese and English interface, and settings that save automatically and take effect immediately.

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

See the [complete gallery of all 94 actions](./README.md#动作展示).

## Installation

### Requirements

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) installed
- `pnpm` available on the command line; `dsh plugin` delegates package management to pnpm
- The Web profile

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
dsh plugin --profile web add .
dsh web
```

Run tests and inspect the npm package contents:

```sh
npm run check
npm test
npm pack --dry-run
```

The project uses DSH's split host/client plugin architecture:

- `lib/index.js`: host-side settings, static animations, custom actions, and balance API
- `lib/client.js`: browser-side playback, interaction, intent arbitration, and settings UI
- `cordis.patch.yml`: DSH bundle registration
- `assets/plugin-logo.png`: plugin logo
- `assets/thumb/`: built-in transparent animations
- `docs/images/screenshots/`: README feature-preview screenshots
- `docs/images/actions/`: low-frame-rate GIF previews for all 94 actions
- `materials/references/`: character first frames and visual references
- `materials/videos/`: AI-generated source MP4 files for traceability and reprocessing, not runtime playback
- `materials/prompts/`: animation-generation prompts

Contributions are welcome through [issues](https://github.com/luweiyabo/dsh-whale-pet/issues) and [pull requests](https://github.com/luweiyabo/dsh-whale-pet/pulls). Run the tests before submitting and never commit API keys or private configuration.

## Usage

### Basic interaction

| Action | Result |
|---|---|
| Hover | The pet faces the pointer side and restores its previous direction on leave; disabled while dragging or coasting |
| Single-click the pet | Plays a head, body, or tail reaction and toggles selection; while selected, click the page to choose a destination |
| Double-click the pet | Plays the “Blue Whale Appears” special animation and clears selection |
| Drag | Moves and places the pet; a quick throw continues with momentum unless Reduce Motion is enabled |
| Drag fully off-screen | Enters edge-hidden mode; move the pointer to that screen edge to reveal the recall handle |
| Right-click | Opens shortcuts for Home, Settings, and Hide |

### Settings

Open **Settings → Plugins → Whale Pet** to configure:

- Visibility, text bubbles, and account-balance bubbles
- Pet size, default corner, and session-awareness scope
- Quiet, balanced, or lively autonomous activity
- Animations for working, coding, reading, researching, thinking, waiting, listening, and error states
- Autonomous, movement, and click-reaction pools
- Custom action upload, preview, and deletion
- Custom event-triggered rules

Settings are saved automatically and applied without restarting.

## Features

### Agent-aware animations

The pet maps Harness activity to configurable intents:

| Harness activity | Default behavior |
|---|---|
| Coding or file operations | Coding at a computer |
| Thinking and reasoning | Deep thought |
| Reading and research | Taking notes |
| Waiting for approval or an answer | Looking around |
| User message | Attentive listening |
| Tool or agent error | Startled reaction |
| No activity | Idle, turn, random action, or roam |

Debounce and linger intervals prevent rapid animation switching. User interaction and high-priority events can interrupt the current animation.

### Autonomous behavior and roaming

- Continuous autonomous animation chain while no session event is active
- Default probabilities: idle 30%, turn 10%, action 40%, movement 20%
- Direction-aware movement with available-space checks
- Relative position persistence across window resizing
- Double-buffered video crossfades
- Support for `prefers-reduced-motion`

### Custom trigger rules

- Built-in templates for tool calls, failures, agent errors, turn completion, and approval requests
- Multiple conditions per rule
- Configurable priority, cooldown, and hold duration
- Test-trigger action and last-triggered status
- Shared priority arbitration with built-in intents

### Account-balance bubble

When `meter` is enabled, the plugin detects the provider used by the current session and displays the balance returned by that provider's official API. It does not estimate token costs.

- Reads the current Harness model configuration and existing credential sources
- Supports `DEEPSEEK_API_KEY`, `MOONSHOT_API_KEY`, and `STEPFUN_API_KEY`, plus provider-specific `apiKeyEnv` settings
- Sends a provider key only to that provider's allowlisted official endpoint, from the local host process
- Disabled by default
- Gracefully reports unsupported providers

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

Custom actions can be added to autonomous pools, assigned to intents, or selected by trigger rules.

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

- Original source code is licensed under the [MIT License](./LICENSE).
- Most animations under `assets/thumb/` come from [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) and are not covered by this project's MIT code license.
- The upstream project currently allows these assets in open-source projects but prohibits commercial use. Review the [third-party asset notice](./THIRD_PARTY_ASSETS_EN.md) and the latest upstream terms before use, redistribution, or modification.
- Because the npm package combines MIT-licensed code with separately licensed media, its package license is `SEE LICENSE IN LICENSE`; the complete package must not be treated as purely MIT-licensed.

This is an independent community plugin and is not affiliated with DeepSeek.
