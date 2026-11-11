# Life Tracker

Personal PWA for tasks, habits, water — and soon workouts, food and spending. Data syncs between phone and PC through Supabase.

## One-time setup

1. **Database** – Supabase dashboard → SQL Editor → New query → paste `supabase/01_core.sql` → Run.
2. **Auth URLs** – Supabase → Authentication → URL Configuration:
   - Site URL: `https://<your-github-name>.github.io/life-tracker/`
   - Redirect URLs: add the same URL and `http://localhost:5173/`
3. **Create your account** in the app ("First time? Create an account"), confirm the email, sign in.
4. **Lock sign-ups** – Supabase → Authentication → Sign In / Providers → turn off "Allow new users to sign up".

## Run locally

```
npm install
npm run dev
```
Open http://localhost:5173 (or the network URL it prints, from your phone on the same Wi-Fi).

## Deploy (GitHub Pages)

Push to a GitHub repo named `life-tracker`, then repo → Settings → Pages → Source: **GitHub Actions**.
Every push to `main` rebuilds the site at `https://<your-github-name>.github.io/life-tracker/`.

On Android: open that URL in Chrome → ⋮ → **Add to Home screen / Install app**.
