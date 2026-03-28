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

[中文文档](README.zh.md)

llmgps is a self-hostable multi-LLM chat workspace.

## Features
- **Modern Interface**: Clean, responsive, and easy to use.
- **Debate Mode**: Advanced multi-model reasoning through structured disagreement.
- **GPS Mode**: Multi-model consensus and synthesis.
- **Mainstream Presets**: Out-of-the-box support for major AI providers.
- **Ollama Integration**: Full support for local model deployment.
- **Encrypted Storage**: History and keys saved in an encrypted SQLite database.
- **Search & Proxy**: Built-in web search support and proxy configuration.

---

### Debate Mode Logic
Choose up to 5 models to tackle complex queries:
1. **Initial Phase**: All models receive the prompt simultaneously.
2. **Consensus Check**: A synthesizer evaluates if the models broadly agree.
3. **Debate Rounds**: If there is friction, models review each other's points and refine their logic.
4. **Search Intervention**: If disagreement persists, the system triggers web search to provide fresh grounding data.
5. **Synthesis**: After a maximum of 2 rounds, the synthesizer generates a final, verified answer.

### GPS Mode Logic
Choose up to 5 models. The system merges their independent responses into one cohesive final answer, highlighting key differences or specific insights from each model.

---

## Screenshots
<img width="960" height="479" alt="UI Desktop" src="https://github.com/user-attachments/assets/3edb46ce-21d3-41fa-b006-d010ba648ab9" />
<img width="381" height="447" alt="UI Mobile" src="https://github.com/user-attachments/assets/cfb64f1f-d073-4d1f-86f1-12b9b9847d45" />

---

## Deployment & Setup

### Docker (Recommended)

**Pull and run:**
```bash
docker pull ghcr.io/leodenglovescode/llmgps:main

docker run -d \
  -p 3000:3000 \
  -e LLMGPS_DATA_KEY=your-secret-key \
  -v llmgps-data:/data \
  --name llmgps \
  ghcr.io/leodenglovescode/llmgps:main
```

**Access**: `http://localhost:3000`

> Set `LLMGPS_DATA_KEY` to any strong secret string. The `/data` volume persists your history and settings.

### Local Development
1. **Install**: `npm install`
2. **Run**: `npm run dev`
3. **Access**: `http://localhost:3000`

### Data & Security
llmgps uses an encrypted SQLite database for all sensitive information.
- **Encryption Key**: Set via `LLMGPS_DATA_KEY`.
- **Key Handling**: In local dev, a `.llmgps-data.key` is auto-generated. In Docker, a key must be manually provided.
- **Persistence**: Mount the `/data` directory to keep your history and keys safe.

### Ollama Support
1. Start Ollama.
2. In llmgps Settings, enable Ollama and set your base URL (e.g., `http://127.0.0.1:11434`).
3. Select your local models directly in the GPS/Debate routing.

---

## Debate Mode Flow Chart

<img width="2695" height="4165" alt="debate-logic-flow" src="https://github.com/user-attachments/assets/c73dcae3-4625-4f86-859d-2d51ccf59dc2" />

---

## Credits & Contributing
- **Logic & Idea**: [@leodenglovescode](https://github.com/leodenglovescode)
- **Assistance**: GitHub Copilot

Contributions are welcome! If you are familiar with the architecture, feel free to open a PR.
