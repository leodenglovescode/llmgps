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









<br><br><br><br><br><br>
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

llmgps 是一个支持多模型协同、可私有化部署的 LLM 聊天工作站。

## 功能特性
- **现代化界面**：响应式设计，操作流程顺滑。
- **辩论模式 (Debate Mode)**：支持多模型深度辩论，产出更严谨的答案。
- **GPS 模式**：多模型结果汇总聚合。
- **主流厂商预设**：内置多家主流 AI 服务商配置。
- **Ollama 支持**：轻松调用本地运行的模型。
- **加密 SQLite 存储**：聊天历史与配置安全保存在服务端。
- **内置代理与联网搜索**：支持实时信息检索增强。

---

### 辩论模式 (Debate Mode)
你可以选择最多 5 个模型处理复杂咨询：
1. **初始阶段**：所有模型同时接收提示词并给出初步观点。
2. **共识检查**：合成器 (Synthesizer) 判断各模型观点是否达成一致。
3. **辩论环节**：若有分歧，模型会阅读彼此的回答并逐点进行辩论与修正。
4. **搜索介入**：若首轮辩论后分歧依然存在，系统将触发联网搜索获取最新证据。
5. **最终裁定**：经过最多 2 轮辩论后，由合成器产出唯一答案。

### GPS 模式
选择最多 5 个模型并行回复。合成器模型会将所有反馈合并为一个逻辑清晰的最终答案，并注明各模型间的核心分歧点。

---

## 应用截图
<img width="960" height="479" alt="Desktop UI" src="https://github.com/user-attachments/assets/3edb46ce-21d3-41fa-b006-d010ba648ab9" />
<img width="381" height="447" alt="Mobile UI" src="https://github.com/user-attachments/assets/cfb64f1f-d073-4d1f-86f1-12b9b9847d45" />

---

## 部署与设置

### 本地开发
1. **安装**：`npm install`
2. **启动**：`npm run dev`
3. **访问**：`http://localhost:3000`

### 数据存储与安全
llmgps 使用加密的 SQLite 数据库存储敏感信息。
- **加密密钥**：通过 `LLMGPS_DATA_KEY` 环境变量设置。
- **密钥管理**：本地开发时会自动生成 `.llmgps-data.key`；Docker 部署时必须手动提供密钥。
- **数据持久化**：请挂载 `/data` 目录以保存你的对话历史和配置。

### Ollama 接入
1. 启动 Ollama。
2. 在 llmgps 设置页面开启 Ollama 并填写 Base URL（如 `http://127.0.0.1:11434`）。
3. 保存后即可在 GPS/辩论路由中直接勾选本地模型。

---

## 辩论模式逻辑流程图 (Debate Mode Logic)

<img width="2695" height="4165" alt="辩论逻辑图" src="https://github.com/user-attachments/assets/c73dcae3-4625-4f86-859d-2d51ccf59dc2" />

---

## 项目致谢与贡献
- **构思与逻辑**：[@leodenglovescode](https://github.com/leodenglovescode)
- **代码辅助**：GitHub Copilot

欢迎参与贡献！如果你熟悉本项目架构，欢迎提交 PR 或反馈 Issue。
