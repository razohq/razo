---
"@razohq/razo-analyzer": patch
---

Mask secrets before they leave the machine: `razo-analyze` redacts the prompt sent to the model and `razo-upload` the payload sent to the dashboard. Known credential shapes (auth headers, bearer tokens, JWTs, URL credentials, provider API keys), the values of credential-like environment variables, and whatever a test types into a password, token, OTP or card field become `[REDACTED]`. The `razo-steps.json` files on disk are unchanged. Exported as `createRedactor` and `redactReport`.
