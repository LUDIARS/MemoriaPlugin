# Downloadable plugin packages

Status: package core and Memoria host adapter merged. Public distribution preparation is described in `deploy/README.md`; actual AWS/Excubitor deployment is reserved for neco.

## User requirements

- Distribute selectable integration plugins from an AWS-hosted catalog.
- Download packages and execute them on the user's machine. The distribution server must not be a runtime dependency.
- Reuse package distribution and installation for other plugin hosts, rather than coupling them to Memoria.
- Restore lazy connections and per-plugin hot reload.
- Keep integration credentials, settings and user data local.

## Boundaries

1. **Package contract** describes identity, version, runtime compatibility, entry points, requested capabilities and artifact integrity. It imports neither Memoria, Hono, SQLite nor AWS libraries.
2. **Package storage and acquisition** reads a catalog or an explicitly selected local archive, verifies it, installs immutable versions and manages the active version. Download transport and catalog authentication are injected. This layer never executes a plugin.
3. **Host adapter** checks host compatibility, supplies capabilities and loads local entry points. Memoria supplies its routes, settings, database and integration APIs here. Other hosts can supply different adapters.
4. **Distribution service** serves catalog metadata and immutable artifacts. It does not execute installed plugins or participate in host startup, activation, reload or shutdown.

These boundaries live in MmP initially; this does not create or publish another repository or package registry.

## Package contract

Use a versioned, host-neutral manifest (`plugin-package.json`) inside a `.tgz` archive. Fields include `schemaVersion`, `id`, `version`, display metadata, `runtime`, `hostApi`, `entry` and requested capabilities. Host compatibility is namespaced, for example an adapter named `memoria`, rather than a mandatory `memoriaPluginApi` field in the shared contract.

The catalog release descriptor carries the artifact URL, byte size and SHA-256 digest. Do not embed an archive's own digest inside that archive: that creates a self-referential checksum. A digest detects corruption but does not authenticate the publisher; catalog trust and authentication are a separate policy.

Build packages with their runtime assets and private dependencies. Do not perform an implicit dependency download or execute install scripts on the user's machine. Explicit host-provided APIs remain compatibility requirements.

Archive validation rejects absolute paths, traversal, links, duplicate/case-colliding paths, Windows device names and alternate data streams. Bound compressed size, expanded size and entry count. Entry points must resolve to regular files within the installed version. Validate identity, version and host compatibility before activation.

Capability declarations describe requested access. An in-process JavaScript plugin is trusted executable code, not a security sandbox; do not claim that manifest declarations alone restrict filesystem or network access.

## Local operation

Persist immutable package versions and active-version metadata outside the Git checkout. Store settings and user data separately from package code.

- Startup lists installed packages from local manifests without contacting the catalog or importing every entry point.
- First use activates the selected package through its host adapter. An explicitly enabled background integration may activate at startup; installing a package does not silently enable background activity.
- A distribution outage affects new downloads and update checks only. Report that failure explicitly while leaving installed plugins usable.
- A local archive can be explicitly installed without contacting the distribution service, using the same validation and trust policy.
- A plugin may require its own integration service. Distribution-server independence does not imply that every plugin works without any network.
- Catalog authentication expiry does not disable already installed packages. No periodic distribution heartbeat or remote runtime-license check is introduced.

## Installation and lifecycle

Installation stages and validates a package, then publishes its immutable local version. Record trusted source and verified digest in installed metadata. Serialize modifications per package; do not allow concurrent installs, updates and removals to corrupt active-version state.

Activation, update and reload are adapter operations. Prepare and validate a replacement before retiring the previous instance. Serialize transitions per plugin, drain or explicitly abort owned work, and dispose timers, connections and listeners. A failed replacement must not silently report success or discard the usable installed version. Module initialization must avoid opening connections; connection ownership belongs to activation/disposal hooks.

Version directories isolate dependency imports between releases; adding a cache-busting query to only the entry point does not refresh imported dependency modules. The development-folder reload path needs an explicit limitation or an isolated module-loading strategy.

Uninstall deactivates code and removes its installation reference. Preserve settings and data unless the user separately requests their deletion. Bundled plugins and local development overrides remain supported through adapters, with precedence bundled < installed package < local override.

## Acceptance criteria

1. Install a selected package, stop access to the distribution endpoint, restart the host and use the installed package successfully without catalog requests.
2. Enumerating installed plugins does not import their executable entries or open integration connections.
3. First use activates once even when requests arrive concurrently; reload does not create duplicate jobs or connections.
4. Interrupted downloads, invalid digests, unsafe archive entries and incompatible packages preserve the previous installation.
5. A failed update leaves the previous version available; restart resolves to a consistent active version.
6. A second host adapter can consume the package/storage layer without importing Memoria-specific code.
7. Credentials and personal data do not enter published packages, catalog metadata or diagnostic output.

## Deployment policy

- Catalog and package downloads are public without authentication. The earlier authenticated-distribution interpretation is superseded by neco's clarification.
- Only neco performs AWS deployment through Excubitor. Agent work prepares code, artifacts and reviewable infrastructure; it does not provision or publish AWS resources.
- `deploy/public-packages.cfn.json` defines public CloudFront distribution with a private S3 origin. No deployment credentials or access tokens are bundled. See `deploy/README.md` for ordered publication and verification.
- The generic transport retains optional authentication support for other hosts; Memoria's public catalog configuration leaves the token unset. Local runtime remains independent of distribution.

## Implementation and use

- `src/packages/` owns the generic contract, HTTPS acquisition and local storage. `host/package-service.ts` is the Memoria-specific adapter.
- `npm run package -- plugins/furusato-nozei 1.0.0 dist/releases` emits an immutable `.tgz` and a release descriptor. `npm run catalog -- dist/public dist/releases/furusato-nozei-1.0.0.json` verifies explicitly selected releases and assembles `catalog.json` beside the archives for HTTPS publication. Builds bundle runtime dependencies; local installation runs no lifecycle scripts or package manager.
- `PackageStore.install` verifies and stages code without executing it. `select`, `active`, `version` and `unselect` operate entirely on disk. `PluginPackages` coordinates activation and active-version persistence.
- Catalog requests are explicit. Redirects and cross-origin artifact URLs are rejected so catalog credentials cannot leak to another origin. Requests have size and time limits. Authentication headers are injected and are never stored with installed package metadata.
- Folder plugins can add `plugin.json` to support import-free discovery. Legacy folders without metadata are still discovered eagerly with a warning. Their connections/jobs activate lazily. The bundled plugin includes metadata.
- `activate(ctx)` acquires resources and immediately registers cleanup with `ctx.onDispose`. `ctx.signal` is aborted on retirement. Jobs cannot overlap themselves, and retirement waits for in-flight jobs. Plugins must implement abort/settlement; arbitrary uncooperative code cannot safely be killed in-process.
- Development-folder reload refreshes the entry module only; dependency edits still need a host restart. Versioned downloaded packages isolate dependencies by directory. Streaming plugin responses must own their own cancellation through `ctx.signal`; returning a response does not guarantee its body has finished streaming.
- `npm test` contains offline package-store, second-host compatibility, path, credential-origin and lazy lifecycle regressions. This task delegates execution to Revisor.

## Excubitor site distribution {#SPEC-MMP-EX-SITE}

See [the site runtime contract](../deploy/excubitor-site.md). AWS hosts an independent read-only distribution service managed by Ex; installed plugin execution stays local to Memoria. This supersedes an S3-only topology assumption.
