# Third Wave Insurance API (Cloudflare Workers)

This backend receives applications from the GitHub Pages form, stores application metadata in a private D1 database, stores documents in a private R2 bucket, and marks each new application `pending` for review. It is not deployed merely by committing these files.

## Deploy prerequisites

1. Create a Cloudflare account with Workers, D1, and R2 available.
2. From `backend/`, create a D1 database and an R2 bucket:

   ```sh
   npx wrangler d1 create thirdwave-insurance-applications
   npx wrangler r2 bucket create thirdwave-insurance-private-documents
   ```

3. Replace `REPLACE_WITH_D1_DATABASE_ID` in `wrangler.toml` with the database ID from Wrangler.
4. Restrict `ALLOWED_ORIGIN` in `wrangler.toml` to the exact origin serving the form. For the configured GitHub Pages URL, that is `https://florasafaris2020-lang.github.io`.
5. Create the schema and set the private admin secret, then deploy:

   ```sh
   npx wrangler d1 execute thirdwave-insurance-applications --remote --file= schema.sql
   npx wrangler secret put ADMIN_TOKEN
   npx wrangler deploy
   ```

   In the schema command, remove the space after `--file=` if your shell requires it (`--file=schema.sql`). Use a long, randomly generated ADMIN_TOKEN and keep it out of the repository and browser code.

6. Copy the deployed Worker URL (for example `https://thirdwave-insurance-api.<your-account>.workers.dev`). Configure the frontend form's action to `<WORKER_URL>/api/insurance-applications`. The current GitHub Pages form action is relative; without a custom-domain route or this action update, it posts to GitHub Pages and cannot reach this Worker. If using a custom domain and Worker route instead, configure the route for `/api/*` and keep the form's relative action.

## API

### Public application submission

`POST /api/insurance-applications` accepts `multipart/form-data` matching the form's field names. The required document field is `Application_Documents`. It accepts a single PDF, JPEG, or PNG file up to 5 MiB, checks its signature, and stores it in the private R2 bucket. Successful responses are JSON with HTTP 201 and `{ "success": true, "id": "...", "status": "pending" }`.

The Worker allows browser requests only from `ALLOWED_ORIGIN` via CORS. This is not a substitute for rate limiting or bot protection; configure Cloudflare rate limiting/Turnstile before public production use.

### Authenticated review

All review routes require `Authorization: Bearer <ADMIN_TOKEN>`. Never expose this token in frontend code.

- `GET /api/admin/applications?status=pending&limit=50` lists applications (including personal information).
- `GET /api/admin/applications/{id}/document` downloads that application's private document.
- `PATCH /api/admin/applications/{id}` with `{"status":"approved","notes":"..."}` or `{"status":"rejected","notes":"..."}` records the review.

These endpoints provide a protected API for a reviewer; this repository does not include a browser-based review dashboard. Use an authorized server-side client or a secure admin application to call them.

## Sensitive data and operations

The form contains identity documents, KRA PINs, and vehicle details. The bucket must remain private; do not enable public access. Restrict access to Cloudflare and trusted reviewers, set a retention/deletion policy for rejected or expired applications, and document consent/privacy handling. Do not send real customer documents until the Worker, database, storage, access controls, retention, and legal requirements are configured and tested.

Do not commit `ADMIN_TOKEN`, customer submissions, or generated secrets. The Worker intentionally avoids logging request bodies or personal information.
