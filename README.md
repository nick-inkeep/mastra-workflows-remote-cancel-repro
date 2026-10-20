# Workflow cancellation from another process

Two Mastra processes use the default workflow engine and the same local LibSQL database. One starts a two-step workflow and waits inside the first step. The other recreates the workflow and run ID, calls `cancel()`, and reads the saved status as `canceled`. After the first step is released, the original process executes the second step and saves `success`.

Expected: the current step may finish, but subsequent steps must not execute, and the run must remain `canceled`.

Actual: the next step executes and the returned and stored statuses become `success`.

## Install and run

From this directory, using Node 22.13 or later:

```sh
npm ci --ignore-scripts
npm run repro
```

`npm run repro` is the command that triggers the failure. It exits 1 on an assertion after printing the observed state sequence:

```text
before-cancel: running
cancel-returned: canceled
step-finished: aborted=false
later-step
result: status=success, persistedStatus=success, laterStepExecuted=true
```

Run the passing control:

```sh
npm run control
```

It runs the same workflow and cancels through the active run's own handle. It exits 0, prints `aborted=true`, returns and saves `canceled`, and does not execute the later step.

No build step is required. Dependencies are pinned to `@mastra/core` 1.78.0, `@mastra/libsql` 1.26.2 and Zod 4.6.7. The original install command was:

```sh
npm install --ignore-scripts --save-exact --registry=https://registry.npmjs.org @mastra/core@1.78.0 @mastra/libsql@1.26.2 zod@4.6.7
```

The program creates a unique `.runs-*` directory beside the script and removes it after its workers close. Each worker has a 60-second failure guard and exits if its parent disconnects. The entry/release handshake fixes the ordering; no elapsed-time assertion or fixed sleep selects the result. The held step deliberately finishes when released, matching the documented case where an ongoing step does not cooperate with cancellation.

## Environment

Tested on macOS 27.0, arm64, Node 24.19.0, npm 11.17.0. No LLM provider or external service is involved.

The output below is from `npx --yes envinfo@7.21.0 --system --binaries --npmPackages`, with the home directory replaced by `~`:

```shell
  System:
    OS: macOS 27.0
    CPU: (18) arm64 Apple M5 Max
    Memory: 2.18 GB / 128.00 GB
    Shell: 5.9 - /bin/zsh
  Binaries:
    Node: 24.19.0 - ~/.local/share/mise/installs/node/24.19.0/bin/node
    Yarn: 1.22.22 - ~/.local/share/mise/installs/node/24.19.0/bin/yarn
    npm: 11.17.0 - ~/.local/share/mise/installs/node/24.19.0/bin/npm
    pnpm: 11.21.0 - ~/.local/share/mise/installs/node/24.19.0/bin/pnpm
    bun: 1.4.2 - ~/.bun/bin/bun
  npmPackages:
    @mastra/core: 1.78.0 => 1.78.0 
    @mastra/libsql: 1.26.2 => 1.26.2 
    zod: 4.6.7 => 4.6.7 
```
