# llmgps

llmgps is a self-hostable multi-LLM chat workspace.

## Features
- Modern Interface
- Debate Mode 
- GPS Mode
- Presets for mainstream AI providers
- Ollama support for local models
- Chat history saved in encrypted SQLite
- Next.js + React Interface


### Debate Mode:
Choose up to 5 models, the same prompt will be fed to all models for their opinions, outputs will be combined as one, then fed to all models (cross-reference), then each model will debate (explain who is right/wrong, and why), then the Synthesizer Model will synthesize all answers, giving users the final answer

### GPS Mode:
Choose up to 5 models, he same prompt will be fed to all models for their opinions, outputs will be synthesized by synthesizer model, then answer will be give to user.


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