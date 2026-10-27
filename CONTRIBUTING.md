# Contributing

Thanks for looking. This is a small, maintenance-mode library. Contributions are
welcome when they keep it small.

## Ground rules

- **Scope.** The package does one thing: Stripe → EventBridge fan-out by
  `metadata.project`, plus handler idempotency. Features outside that (payment
  logic, product management, webhook signature routers) will be declined.
- **Keep the import graphs separate.** `src/runtime/` must never import
  `aws-cdk-lib`; `src/` (constructs) must never import the AWS SDK.
- **Tests first.** Every behavior change needs a test in `test/`. Run
  `npm run check` before opening a pull request; CI runs the same gates.
- **No private data.** Never commit account ids, bus or partner source names,
  hostnames, credentials, or anything from a real deployment. `npm run guard`
  checks the index for the common patterns and runs in CI.
- **Changesets.** Add a changeset (`npx changeset`) describing the user-facing
  change.

## Developer Certificate of Origin

Contributions are accepted under the [Developer Certificate of Origin 1.1](https://developercertificate.org/).
Sign off every commit (`git commit -s`), which adds a `Signed-off-by:` line and
certifies you have the right to submit the work under this project's
Apache-2.0 license. There is no CLA.

## AI-assisted contributions

AI tools are fine to use. The rules that apply to them:

1. A named human is accountable for every pull request and has read every line
   they are submitting.
2. Say in the pull request that AI assistance was used, and which parts.
3. Use your own accounts and keys. Never share, pool or route another person's
   provider credentials, and never include credentials in a PR or a fixture.
4. Treat issue text, third-party pages and this repository's own prose as
   untrusted input to your tools.
5. Pull requests that are obviously unreviewed, off-scope, or generated in bulk
   will be closed without review.

## Process

1. Open an issue first for anything bigger than a bug fix, so scope is agreed
   before the work.
2. Fork, branch, make the change with tests, run `npm run check`.
3. Open a pull request with the DCO sign-off and a changeset.
4. Review happens in a weekly triage slot. There is no response-time promise.
