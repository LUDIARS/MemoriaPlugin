# MemoriaPlugin distribution on an Excubitor site

## Deployment contract {#SPEC-MMP-EX-SITE}

AWS is a normal Excubitor site. Its persistent supervisor owns this standalone
`memoriaplugin-distribution` service. Memoria remains on the user's machine: it
downloads packages and executes them locally. No LLM or Memoria database runs in
the distribution service. Tabula and other future services use their own catalogs.

The current implementation uses a process on an Ex-managed host, not the S3/CloudFront
stack in `public-packages.cfn.json`. That template remains an alternative operator
artifact and is not part of this deployment path. No AWS resources are provisioned
by the build or server.

## Build and runtime

- `excubitor.catalog.yaml` owns the service code, port, command, health URL and build command.
- `deploy/distribution.json` explicitly selects package sources and versions and the
  persistent publication directory. Relative paths are resolved from the repository root.
- Ex runs `npm run build:distribution` after fetching Git and installing dependencies.
  Install development dependencies as well; compilation and packaging require tsx/esbuild.
- The builder invokes the existing package and verified catalog assemblers. It bundles
  the HTTP service, records build identity, creates immutable archives, then atomically
  promotes `catalog.json` only after every step succeeds. Existing releases remain available.
- Reusing a version with changed bytes or metadata is rejected. Increment its version
  in the release selection for an intentional change; do not delete old archives to bypass this.
- A `.build.lock` in the publication directory excludes concurrent publishers. An interrupted
  build leaves a lock rather than silently allowing two writers. An operator may remove
  it only after verifying no publisher is running. Ex reports the failed build step.
- Build output and publication data are ignored by Git. Keep the publication directory
  on persistent storage and back it up separately. The server never rewrites it.
- Restart through Ex to activate the verified catalog snapshot. A failed build leaves
  the running process and its in-memory catalog usable. A corrupt publication prevents startup.

## Site and public endpoint setup (operator action)

1. Clone Excubitor and MemoriaPlugin into the site's workspace as normal main checkouts.
   Install Ex with its persistent OS supervisor, set its workspace root, and use the
   existing Tailscale/Cloudflare Mesh federation listener and mutual peer registration.
2. Confirm the service-owned catalog is trusted and discovered. In the AWS site's
   coverage settings, enable `memoriaplugin-distribution`; disable coverage on any
   development site that should not manage it. Autostart is initially false.
3. Configure an HTTPS reverse proxy or tunnel to the catalog's loopback address.
   Set `MMP_PUBLIC_URL` to the chosen HTTPS origin through Ex runtime configuration.
   Ex's `LUDIARS_ALLOWED_HOSTS` is also honored, including leading-dot domain entries.
   The backend never binds to a public interface. Viewer is disabled.
4. Use Ex `deploy` to fetch/install/build. If stopped, it remains stopped by design:
   request `start` separately when deployment is authorized. Subsequent deploys restart
   a running service after a successful build. Follow each returned operation ID.
5. Configure Memoria's `MEMORIA_PLUGIN_CATALOG_URL` as `https://<chosen-host>/catalog.json`.
   The current public distribution policy requires no token. No actual domain is guessed
   or committed here; external publication is a separate operator action.

## HTTP and monitoring

`GET`/`HEAD /catalog.json` returns the existing schemaVersion 1 catalog with no-store.
Only named `.tgz` artifacts present in the verified catalog are downloadable, with
immutable caching. Other paths are 404 and other methods are 405. Arbitrary files,
uploads and code execution are not exposed. Memoria performs backend downloads;
no browser CORS or Viewer access is required.

`GET`/`HEAD /health` returns cached startup identity and catalog count, with no disk
scan, DB work or network request. Ex's ordinary monitor and federation cache report
service death, site unreachability and stale observations. A successful build or
restart request is not proof that the HTTPS download endpoint is reachable.

## Acceptance (not executed by this implementation session)

Verify authorized Git update/build/restart operations and their failure history;
check `/health` and anonymous HTTPS catalog/archive downloads; verify digest and
installation in Memoria; then confirm installed plugins still work while distribution
is unavailable. Check unknown Host/Origin rejection, archive immutability, failed-build
preservation and interrupted-publisher recovery. Service tests and deployment require
their own authorization and must run through Ex from main checkouts, never worktrees.
