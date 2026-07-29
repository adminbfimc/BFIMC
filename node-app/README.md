# BFIMC Node app

This folder contains the Node.js version of the BFIMC website. Its HTML page fragments live in `views/`, and it serves the existing static assets from `../assets/`.

## Run it

1. In this folder, run `npm install`.
2. Copy `.env.example` to `.env`, then supply the Supabase URL and anon key along with any SMTP settings.
3. In Supabase Dashboard, open **SQL Editor** and run [`supabase.sql`](./supabase.sql).
4. In **Authentication → Email Templates → Confirm signup**, paste [`supabase-email-template.html`](./supabase-email-template.html). It provides both an OTP code and a confirmation link. Add `http://localhost:3000/auth/callback` and your deployed `/auth/callback` URL under **Authentication → URL Configuration → Redirect URLs**.
5. Run `npm start` and open `http://localhost:3000`.

Routes are `/`, `/portfolio`, `/membership`, `/services`, `/contact`, `/membership-form`, and `/loan-form`.

Contact, membership, and loan forms post to Node routes. Member accounts use Supabase Auth and profile details are stored in the `public.profiles` table protected by row-level security. Email credentials are read only from `.env`; no legacy PHP credential is reused or exposed by the Node server.

## First administrator

`adminbfimc@gmail.com` is configured as the initial administrator in [`supabase.sql`](./supabase.sql). Create and verify that account in Supabase Auth, then run the SQL file (or rerun its final administrator statement) in the Supabase SQL Editor. That account will be redirected to `/admin` on login and can add or remove other administrators there.

## Deploy to Vercel

1. Import the repository into Vercel with the repository root as the project root.
2. Add `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and a long random `SESSION_SECRET` under **Project Settings → Environment Variables**. Add SMTP variables only when email forwarding is needed.
3. Deploy. The root [`vercel.json`](../vercel.json) routes the website and assets to the Express serverless handler.
4. In Supabase **Authentication → URL Configuration**, add `https://your-vercel-domain.vercel.app/auth/callback` as a Redirect URL; add your custom domain equivalent if used.
