# llmgps

[![Docker](https://img.shields.io/badge/docker-ghcr.io-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://github.com/leodenglovescode/llmgps/pkgs/container/llmgps)
[![CI](https://img.shields.io/github/actions/workflow/status/leodenglovescode/llmgps/docker-publish.yml?style=for-the-badge&label=CI&logo=githubactions&logoColor=white)](https://github.com/leodenglovescode/llmgps/actions)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![GitHub Stars](https://img.shields.io/github/stars/leodenglovescode/llmgps?style=for-the-badge&logo=github&logoColor=white&color=gold)](https://github.com/leodenglovescode/llmgps/stargazers)
[![Last Commit](https://img.shields.io/github/last-commit/leodenglovescode/llmgps?style=for-the-badge&logo=github&logoColor=white)](https://github.com/leodenglovescode/llmgps/commits/main)
[![License: MIT](https://img.shields.io/badge/license-MIT-22c55e?style=for-the-badge)](LICENSE)

llmgps is a self-hostable multi-LLM chat workspace.

## Features
- Modern Interface
- Debate Mode 
- GPS Mode
- Presets for mainstream AI providers
- Ollama support for local models
- Chat history saved in encrypted SQLite
- Next.js + React Interface
- Inbuilt Proxy Support
- Web Search Support 


### Debate Mode:
Choose up to 5 models. The same prompt is sent to all models simultaneously for their initial opinions. The synthesizer then checks whether the models broadly agree. If not, a debate round begins — each model reads the others' responses and refines its position point-by-point. If disagreement persists after round 1, web search re-runs to supply fresh evidence before a second round. After at most 2 rounds the synthesizer produces a single final answer. Optionally, debate context can be compressed into a rolling summary to keep later rounds within context limits.

### GPS Mode:
Choose up to 5 models. The same prompt is sent to all models simultaneously for their initial opinions. The synthesizer model merges all responses into one cohesive final answer, noting any key disagreements.

## Screenshots
<img width="960" height="479" alt="Screen Shot 2026-03-17 at 11 44 11" src="https://github.com/user-attachments/assets/3edb46ce-21d3-41fa-b006-d010ba648ab9" />
<img width="381" height="447" alt="Screen Shot 2026-03-17 at 11 44 35" src="https://github.com/user-attachments/assets/cfb64f1f-d073-4d1f-86f1-12b9b9847d45" />


## Local development

1. Install dependencies:

	```bash
	npm install
	```

2. Start the app:

	```bash
	npm run dev
	```

3. Open http://localhost:3000 or http://your-local-ip:3000

## First-run setup

1. Start the app.
2. On first visit, create the local owner username and password.
3. Sign in with that owner account.
4. On first login, choose whether to go straight to Settings and add provider API keys.

Provider API keys, Ollama settings, routing defaults, and chat history are stored on the server in an encrypted SQLite database instead of browser storage.

## Data storage

By default, local development stores owner credentials, provider API keys, Ollama settings, saved chats, and proxy settings in `.llmgps-data.sqlite` at the project root.

Sensitive fields are encrypted before being written to SQLite.

Encryption key handling:
- If `LLMGPS_DATA_KEY` is set, llmgps uses that value as the encryption secret.
- If `LLMGPS_DATA_KEY_FILE` is set, llmgps reads the encryption secret from that file.
- In local development only, if neither is set, llmgps creates `.llmgps-data.key` beside the app and uses that automatically.
- In Docker, llmgps will not auto-generate a key file. You must provide `LLMGPS_DATA_KEY` or `LLMGPS_DATA_KEY_FILE`.

## Ollama

1. Start Ollama locally or on a reachable machine.
2. Open Settings.
3. Enable Ollama and set the base URL, such as `http://127.0.0.1:11434`.
4. Save the setting, then choose Ollama models in GPS routing.

Ollama does not require an API key. Only the saved base URL is stored server-side.

## Chat History

Every saved conversation is written into the encrypted SQLite store and can be reopened from the History view. New chats can be started without losing older conversations.

You can override that location with `LLMGPS_DATA_FILE`.

Example:

```bash
LLMGPS_DATA_FILE=/data/llmgps-data.sqlite npm run start
```

Legacy `.llmgps-data.json` installs are migrated automatically the first time the new store is opened.

## Environment

See [.env.example](.env.example).

## Docker

The container defaults to storing data in `/data/llmgps-data.sqlite`, runs as the non-root `node` user, and expects the encryption key to come from the host.

### Run the pre-built image

The latest image is published automatically to the GitHub Container Registry on every push to `main`:

```bash
docker run --rm -p 3000:3000 \
	-e LLMGPS_DATA_KEY=$(openssl rand -hex 32) \
	-v $(pwd)/llmgps-data:/data \
	ghcr.io/leodenglovescode/llmgps:main
```

Then open http://localhost:3000.

> **Note:** Generate your key once and store it somewhere safe. If you lose the key, your encrypted data cannot be recovered. You can save it to a file and use `LLMGPS_DATA_KEY_FILE` instead (see below).

### Build and run locally

Build and run:

```bash
docker build -t llmgps .
docker run --rm -p 3000:3000 \
	-e LLMGPS_DATA_KEY=$(openssl rand -hex 32) \
	-v $(pwd)/llmgps-data:/data \
	llmgps
```

Using a mounted secret file instead of an inline environment variable:

```bash
docker run --rm -p 3000:3000 \
	-e LLMGPS_DATA_KEY_FILE=/run/secrets/llmgps_data_key \
	-v $(pwd)/llmgps-data:/data \
	-v $(pwd)/llmgps_data_key:/run/secrets/llmgps_data_key:ro \
	llmgps
```

Only mount `/data` persistently. Do not persist a generated key file beside the database inside the container.

## Credits
Idea and Logic by @leodenglovescode
Code assisted by Github Copilot

## Contributing
If you are familiar with my project structure and general idea, please DO contribute!
