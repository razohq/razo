# @razohq/razo-analyzer

## 0.1.2

### Patch Changes

- eaab25c: Mask secrets before they leave the machine: `razo-analyze` redacts the prompt sent to the model and `razo-upload` the payload sent to the dashboard. Known credential shapes (auth headers, bearer tokens, JWTs, URL credentials, provider API keys), the values of credential-like environment variables, and whatever a test types into a password, token, OTP or card field become `[REDACTED]`. The `razo-steps.json` files on disk are unchanged. Exported as `createRedactor` and `redactReport`.

## 0.1.1

### Patch Changes

- f42ae34: The GitHub Action works without the package installed and posts its PR comment: it ran `npx razo-analyzer`, a name that does not exist on npm, and never passed `GITHUB_TOKEN`. It now runs `@razohq/razo-analyzer` and takes `github-token` (the workflow token by default). It also supports OpenAI like the CLI: `provider`, `openai-api-key` and `model` inputs; `anthropic-api-key` is no longer required. The docs and the package description say Claude is the default, not the only provider.
