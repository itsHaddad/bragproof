# The bragproof runner: installs a subject, runs its check and prints an attested receipt.
# Verifiers accept a run only when the attestation names this image's digest (see runners.json).
FROM oven/bun:1.2.21-slim@sha256:9759e7229cd7c2939d960420bdb8dc5dc3b3dda0285f8601226606e5fd97dfdf AS bun
FROM node:24.22.2-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
# The jail needs setpriv and chroot. git must be absent: without it npm cannot fetch git dependencies, which
# are built in ways the install flags do not cover.
RUN command -v setpriv && command -v chroot && ! command -v git
WORKDIR /runner
COPY package.json runners.json ./
COPY src ./src
# Confidential Space launch policy: the operator may pass the spec and a feed address, nothing else, and may
# not change the command. Output goes to the log so the receipt can be collected.
LABEL "tee.launch_policy.allow_env_override"="CHECK_SPEC_B64,FEED_URL"
LABEL "tee.launch_policy.allow_cmd_override"="false"
LABEL "tee.launch_policy.log_redirect"="always"
# Root on purpose: the runner jails the package under test (chroot, as "nobody") and first proves that a
# process started that way cannot open the attestation socket, so the package cannot ask for a token of its own.
USER root
ENTRYPOINT ["bun", "src/cli/main.ts", "run"]
