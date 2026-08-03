# shared-contracts

The OpenAPI spec (`openapi.yaml`) is the contract between `apps/api` (Go) and
`apps/web` (Next.js). As real endpoints are added:

- Generate Go server types/interfaces with [oapi-codegen](https://github.com/oapi-codegen/oapi-codegen)
  into `apps/api/internal/platform` (or a dedicated `gen` package).
- Generate the TypeScript client with [openapi-typescript](https://github.com/openapi-ts/openapi-typescript)
  into `apps/web/lib`.

Hand-writing duplicate request/response types on either side defeats the
point of this package — the spec is the source of truth, both sides are
generated artifacts.
