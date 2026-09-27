# Public package distribution — neco deployment handoff

Package metadata and downloads are **public, without login or a token**. AWS / Excubitor deployment is performed **only by neco**. This repository supplies an offline build and a CloudFormation template; it does not run an AWS deployment, grant IAM access, or change Excubitor permissions.

## Prepare locally

From the repository root, with Node 22 and development dependencies installed:

```text
npm run package -- plugins/furusato-nozei 1.0.0 dist/releases
npm run catalog -- dist/public dist/releases/furusato-nozei-1.0.0.json
```

The parent `dist` directory must exist; the catalog output directory must be new. Pass additional release descriptor paths explicitly to include other packages or retained versions. The builder verifies digests, size, archive safety and matching manifests without executing package code. It emits only `catalog.json` and the referenced `.tgz` archives, never the input directory's other files. Rebuild to a new folder for each publication. Do not edit a release under an already published version.

## AWS / Excubitor handoff

1. neco validates `public-packages.cfn.json` and reviews the resulting change set in the authorized AWS/Ex deployment environment, then creates or updates the stack. Use a short stack name (at most 48 characters). No AWS account, deployment role, region or Ex control endpoint is assumed by this repository.
2. The template creates a versioned, encrypted private S3 origin and an anonymously readable HTTPS CloudFront distribution using OAC. S3 public access remains blocked; viewers access CloudFront without authentication. The template grants CloudFront read access only and does not create a publisher identity. neco's deployment role remains externally managed.
3. Inspect the staged archives for intended public content, including bundled dependencies and their licenses. Upload **only the generated archives first**, with `Content-Type: application/gzip` and `Cache-Control: public,max-age=31536000,immutable`. Use conditional create (`If-None-Match: *`) for each object; if a key exists, verify its SHA-256 against the descriptor and reuse only identical bytes. Never overwrite a published archive or recursively upload the repository. Do not delete old releases during an update.
4. After all archive uploads succeed, publish `catalog.json` last, with `Content-Type: application/json` and `Cache-Control: no-store`. Catalog promotion must be serialized by the deployment operator. The distribution disables caching for catalog and other non-archive paths. Preserve the previous catalog object version for rollback.
5. Use the stack's `CatalogUrl` as `MEMORIA_PLUGIN_CATALOG_URL`. Leave `MEMORIA_PLUGIN_CATALOG_TOKEN` unset. No bearer token, signed URL, Cloudflare Access login or runtime distribution connection is required. Memoria downloads through its backend; browser CORS is not needed for this integration.
6. Record anonymous HTTPS catalog/archive retrieval, digest agreement, installation, and subsequent operation with the distribution endpoint unavailable. AWS resource validation and end-to-end acceptance require neco's deployed environment; local typechecking is not evidence of successful deployment.

The generated CloudFront domain works without a custom DNS name or ACM certificate. A future domain can be configured separately. The bucket is retained on stack deletion/replacement; cleanup and rollback remain explicit operator actions. Distribution outage affects acquisition, not already installed package execution.

The checked Excubitor `service-deployed` dispatcher reports runtime deployment events; it is not an AWS stack/upload API. No unverified Ex endpoint or automatic deploy command is supplied here. Hand these inputs to neco's existing Ex deployment workflow.

AWS references: [S3 origin access control](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html), [cache policy](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-cloudfront-cachepolicy-cachepolicyconfig.html).
