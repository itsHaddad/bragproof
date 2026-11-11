# The claimcheck runner: installs a subject, runs its check and prints an attested receipt.
# Verifiers accept a run only when the attestation names this image's digest (see runners.json).
FROM oven/bun:1.2.21-slim AS bun
FROM node:22.20.0-bookworm-slim
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /runner
COPY package.json runners.json ./
COPY src ./src
# Confidential Space launch policy: the operator may pass the spec and a feed address, nothing else, and may
# not change the command. Output goes to the log so the receipt can be collected.
LABEL "tee.launch_policy.allow_env_override"="CHECK_SPEC_B64,FEED_URL"
LABEL "tee.launch_policy.allow_cmd_override"="false"
LABEL "tee.launch_policy.log_redirect"="always"
ENTRYPOINT ["bun", "src/cli/main.ts", "run"]
