# llmgps

llmgps is a self-hostable multi-LLM chat workspace.

## Features
- Modern Interface
- Debate Mode 
- GPS Mode
- Presets for mainstream AI providers
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

3. Open http://localhost:3000

## Environment

See [.env.example](.env.example).

## Docker

Build and run:

```bash
docker build -t llmgps .
docker run --rm -p 3000:3000 llmgps
```

