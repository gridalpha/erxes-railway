# erxes-railway

The `core-api` tier of an [erxes](https://erxes.io) XOS deployment on
[Railway](https://railway.com). It is upstream's published
`erxes/erxes-next-core-api:latest` image plus one wrapper entrypoint.

## Why a wrapper image

erxes creates its first administrator through the `usersCreateOwner` GraphQL
mutation, which is open to **anonymous** callers for as long as the `users`
collection is empty:

```ts
const userCount = await models.Users.countDocuments();
if (userCount > 0) throw new Error('Access denied');
```

On a one-click deploy that means whoever loads the public URL first becomes the
owner of the workspace. There is no environment variable for a first admin and
no CLI command that creates one.

`seed-owner.mjs` closes the window from inside the container, before this
service ever answers a request that arrived from the internet:

1. Count `users` over the app's own `MONGO_URL`. Non-zero → exit immediately, so
   every deploy after the first costs one round trip and nothing else.
2. Otherwise start core-api on `127.0.0.1:3399` — a port no domain and no
   sibling service targets — wait for its `/health`, and call
   `usersCreateOwner` over loopback.
3. Stop that instance and `exec` the real one on `$PORT`.

Seeding through the app's own mutation rather than an `insertOne` means the
password is hashed the way erxes hashes it (`bcrypt(sha256hex(password))`), the
user code is allocated, and every other field the app expects is written by the
app. The `Access denied` guard makes the whole step idempotent, so it can never
revert a password the operator has since changed.

Leave `ERXES_OWNER_EMAIL` / `ERXES_OWNER_PASSWORD` unset to skip seeding and use
erxes' own first-run owner form instead.

## Environment

| Variable | Required | Notes |
|---|---|---|
| `MONGO_URL` | yes | `${{MongoDB.MONGO_URL}}/erxes?authSource=admin` |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` | yes | service discovery, BullMQ, cache |
| `JWT_TOKEN_SECRET` | yes | must match every other erxes service |
| `DOMAIN` | yes | the deployment's single public origin |
| `ENABLED_PLUGINS` | yes | comma list, e.g. `frontline,sales,operation` |
| `LOAD_BALANCER_ADDRESS` | yes | this service's own private URL, e.g. `http://core-api.railway.internal:3300` |
| `PORT` | yes | `3300` |
| `VERSION` | yes | `os` — `saas` switches on multi-tenant organization lookups |
| `ERXES_OWNER_EMAIL` | no | first owner; unset leaves erxes' own form open |
| `ERXES_OWNER_PASSWORD` | no | ≥ 8 chars with an upper, a lower and a digit |
| `ERXES_OWNER_FIRST_NAME` / `_LAST_NAME` | no | defaults `Owner` |
| `ERXES_BOOTSTRAP_PORT` | no | loopback port used while seeding, default `3399` |
| `UPLOAD_SERVICE_TYPE`, `AWS_*` | no | S3-compatible uploads; see the deployment profile |

## Companion services

| Service | Image | Notes |
|---|---|---|
| gateway | `erxes/erxes-next-gateway:latest` | Apollo Router supergraph + proxy to core |
| core-ui | `erxes/erxes-next-ui:latest` | the React host application |
| frontline-api | `erxes/erxes-next-frontline_api:latest` | inbox, tickets, knowledge base |
| sales-api | `erxes/erxes-next-sales_api:latest` | deal pipelines |
| operation-api | `erxes/erxes-next-operation_api:latest` | tasks, projects, cycles |
| automations | `erxes/erxes-next-automations:latest` | trigger/action engine |
| logs | `erxes/erxes-next-logs:latest` | audit journal behind System Logs → Undo |
| proxy | `caddy:2-alpine` | one public origin: `/` → core-ui, `/gateway/*` → gateway |
| MongoDB, Redis | Railway managed | |

The single-origin proxy is upstream's own production shape — erxes' frontend
defaults its API base to `<origin>/gateway`, and its `auth-token` cookie is then
first-party rather than a cross-site cookie between two `*.up.railway.app`
hosts.

## Licence

erxes is AGPL-3.0. This repository only adds the entrypoint above.
