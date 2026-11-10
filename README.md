# Deal Portal

The team's auto-finance deal tracker: pipeline board, a chat on each deal with @mentions, an inbox, and private licence storage. Built with Next.js and Supabase. The spec lives at https://claude.ai/artifact/3Lx8kcnj3a2mgg1XhW1Hwh.

## Setup (one time)

1. **Create the Supabase project.** At supabase.com, create a new project and pick the **Canada (Central)** region. Keep the database password somewhere safe.
2. **Create the database.** In the project, open **SQL Editor** and run each file in `supabase/migrations/`, oldest first.
3. **Lock sign-ups.** Go to **Authentication → Sign In / Providers** and turn off **Allow new users to sign up**. Only people TJ adds can get in.
4. **Add the team.** Under **Authentication → Users → Add user**, create TJ, Sam, Corbin and Ahmed with their email and a temporary password, and tick **Auto confirm**.
5. **Set names and roles.** Put the real emails into `supabase/setup_team.sql`, then run it in the SQL Editor. The last line should list TJ as admin, Sam as lead, and Corbin and Ahmed as agents.
6. **Connect the app.** Copy `.env.example` to `.env.local` and fill in the project URL and the anon (publishable) key from **Project Settings → API**.

People sign in with their email and password. Anyone without a team profile sees nothing.

## Running it

```
npm install
npm run dev        # http://localhost:3000
npm run test:db    # checks every permission rule against the database schema
npm run build
```

## Where things live

| What | Where |
| --- | --- |
| Tables, permissions, stage rules | `supabase/migrations/` |
| Stage list and the moves each role can make (UI copy of the database rules) | `src/lib/stages.ts` |
| Data loading, live updates, actions | `src/components/PortalProvider.tsx` |
| Deal panel: details, licence, lenders, chat | `src/components/DealPanel.tsx` |
| Screens | `src/app/(portal)/` |
| Look and feel (colour tokens, light and dark) | `src/app/globals.css` |

The database has the final say on every permission. The app hides buttons people can't use, but even a hand-crafted request can't move a stage, read another agent's deal, or open a licence it shouldn't.

## Adding features

- New lenders and lost reasons: TJ adds them in **Settings**, no code needed.
- Database changes go in a new file in `supabase/migrations/`, never by editing the first one after it has run. Add a check for any new rule to `tests/db-rules.test.mjs` and run `npm run test:db`.
