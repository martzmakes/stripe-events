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

## Releasing

Prepare the version and changelog with `npm exec -- changeset version` when
releasing queued changesets, then run `npm install --package-lock-only` to sync
the lockfile. Version `0.1.0` is already set in the initial release.

From the repository root, use Node.js 22 or 24 and verify the release locally.

```sh
npm ci
npm run check
npm run synth:examples
npm audit --omit=dev
npm pack --dry-run
```

The tarball should contain `dist/`, `package.json`, `README.md`, `LICENSE`, and
`NOTICE`. Review the Git history before making the repository public.

For a brand-new npm package, the package settings for trusted publishing become
available after package creation. From a reviewed checkout of the public source,
build and pack the release with `npm pack`. An npm maintainer with access to the
`@martzmakes` scope can publish the reviewed tarball interactively with
`npm publish ./martzmakes-stripe-events-0.1.0.tgz --access public --no-provenance`
and the account's 2FA prompt. This first local publication has no CI provenance
attestation. [Scoped public packages](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/)

For later versions, register `martzmakes/stripe-events` as a GitHub Actions
trusted publisher in the npm package settings. Use workflow filename
`release.yml`, GitHub environment `npm`, and allow direct `npm publish`. Once
the version and changelog are on `main`, dispatch the Release workflow from
`main`. It builds and publishes with provenance from the public repository.
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
