---
'@razohq/razo-analyzer': patch
---

The GitHub Action works without the package installed and posts its PR comment: it ran `npx razo-analyzer`, a name that does not exist on npm, and never passed `GITHUB_TOKEN`. It now runs `@razohq/razo-analyzer` and takes `github-token` (the workflow token by default). It also supports OpenAI like the CLI: `provider`, `openai-api-key` and `model` inputs; `anthropic-api-key` is no longer required. The docs and the package description say Claude is the default, not the only provider.
