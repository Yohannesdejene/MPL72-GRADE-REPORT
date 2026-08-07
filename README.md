# Telegram Grade Bot

A simple Telegram bot with **one admin**, who registers students by name and enters their
grades. Each student only ever sees their **own** grades — never anyone else's.

Stack: Node.js + Express + Sequelize (Postgres) + [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api).
Designed for **Neon** (Postgres) + **Render** (hosting).

---

## How registration works (no manual Telegram ID entry)

The admin never has to type or look up a student's Telegram ID. Instead:

1. Admin runs `/addstudent Full Name`.
2. The bot creates the student record and replies with a short **registration code**
   (and a ready-to-share link).
3. Admin sends that code/link to the student (WhatsApp, in person, however).
4. The student opens the bot and sends `/start <code>` — or just taps the link — and the bot
   **automatically** attaches their real Telegram ID/username to that student record.
5. From then on, that student can send `/mygrades` and only ever see their own grades.

The admin can add grades for a student by name (or code) **even before** the student has
linked their account — the grade is tied to the internal student record, and will show up
as soon as they do link.

## Commands

| Command | Who | Description |
|---|---|---|
| `/start` or `/start <code>` | everyone | students link their account with the code from the admin |
| `/help` | everyone | list commands (shows extra admin commands if you're the admin) |
| `/mygrades` | everyone (once linked) | view your own grades |
| `/addstudent Full Name` | admin only | register a new student, get back a code/link to send them |
| `/addgrade name-or-code\|subject\|score\|term` | admin only | add or update a grade. `term` is optional. Example: `/addgrade John Doe\|Mathematics\|95\|Term 1` |
| `/liststudents` | admin only | list all students with their link status (linked / pending + code) |
| `/deletegrade id` | admin only | delete a grade by its numeric ID |

> If two students share the exact same name, `/addgrade` will show you both with their codes
> so you can use the code instead to disambiguate.

---

## 1. Create the Telegram bot

1. Open Telegram, message **[@BotFather](https://t.me/BotFather)**.
2. Send `/newbot` and follow the prompts.
3. Copy the token it gives you (looks like `123456789:AAExample...`) — this is `TELEGRAM_BOT_TOKEN`.
4. Message **[@userinfobot](https://t.me/userinfobot)** to get your own numeric Telegram ID —
   this goes into `ADMIN_TELEGRAM_IDS` (just one ID, since there's a single admin).

## 2. Create the database on Neon

1. Sign up / log in at [neon.tech](https://neon.tech), create a new project.
2. Copy the **connection string** (Dashboard → Connection Details). It looks like:
   ```
   postgresql://user:password@ep-xxxx.neon.tech/dbname?sslmode=require
   ```
3. That's your `DATABASE_URL`. Tables (`students`, `grades`) are created automatically on
   first run via `sequelize.sync()` — no manual migration needed.

## 3. Run locally (optional, polling mode)

```bash
cp .env.example .env
# fill in DATABASE_URL, TELEGRAM_BOT_TOKEN, ADMIN_TELEGRAM_IDS
# leave WEBHOOK_URL empty for local dev

npm install
npm run dev
```

With `WEBHOOK_URL` unset, the bot uses **polling**, so it works immediately without a public
URL — good for testing on your machine.

## 4. Deploy the backend to Render

1. Push this project to a GitHub repo.
2. On [Render](https://render.com): **New → Web Service**, connect the repo.
3. Settings:
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Instance type:** free/starter is fine for a simple bot.
4. Add environment variables in the Render dashboard:
   - `DATABASE_URL` → your Neon connection string
   - `TELEGRAM_BOT_TOKEN` → from BotFather
   - `ADMIN_TELEGRAM_IDS` → your Telegram ID
   - `WEBHOOK_URL` → `https://<your-render-service>.onrender.com` (set this **after** the
     first deploy once you know the URL, then redeploy/restart)
5. Deploy. On startup, the app automatically calls `setWebHook` against
   `WEBHOOK_URL/webhook/<token>`, so Telegram will start pushing updates to your Render app —
   no polling needed in production.

That's it — message your bot as the admin and send `/start`, then try `/addstudent Jane Doe`.

---

## Project structure

```
src/
  config/database.js   # Sequelize + Neon Postgres connection
  models/Student.js     # students, registered by admin (name + code), linked later
  models/Grade.js        # grade records, tied to a studentId
  models/index.js        # associations (Student hasMany Grade)
  bot/index.js            # all bot commands & admin logic, code generation/linking
  server.js               # Express app, webhook endpoint, startup
```

## Notes / possible extensions

- `score` is stored as a string on purpose, so the admin can enter `95`, `A`, `95%`, etc.
- Grades are keyed by `(studentId, subject)`, so re-running `/addgrade` for the same subject
  **updates** the existing grade instead of duplicating it.
- Registration codes are 6 characters (letters/digits, no ambiguous `0/O/1/I`), one-time use.
- Want a web dashboard too? The same Sequelize models can be reused behind a small Express API —
  ask and it can be added.
