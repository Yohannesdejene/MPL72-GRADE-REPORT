require("dotenv").config();
const express = require("express");
const { sequelize, Student } = require("./models");
const { createBot } = require("./bot");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const token = process.env.TELEGRAM_BOT_TOKEN;

app.get("/", (req, res) => {
  res.send("Telegram Grade Bot is running ✅");
});

async function seedAdminFromEnv() {
  const adminUsername = process.env.ADMIN_TELEGRAM_UISERNAME;
  const adminId = process.env.ADMIN_TELEGRAM_IDS;

  if (!adminUsername || !adminId) {
    console.log("Admin username or ID not set in .env");
    return;
  }

  try {
    const existing = await Student.findOne({
      where: { username: adminUsername },
    });

    if (!existing) {
      await Student.create({
        fullName: "Admin",
        username: adminUsername,
        role: "admin",
      });
      console.log(`✅ Admin user @${adminUsername} created.`);
    }
  } catch (err) {
    console.error("Error seeding admin:", err.message);
  }
}

async function start() {
  try {
    await sequelize.authenticate();
    console.log("Database connected.");

    // Force recreate tables (drops existing tables and recreates them)
    // await sequelize.sync({ force: true });
    console.log("Database tables synchronized.");

    // Pre-register admin from env
    await seedAdminFromEnv();

    const bot = createBot();

    // Only needed in webhook mode (production on Render).
    if (process.env.WEBHOOK_URL) {
      app.post(`/webhook/${token}`, (req, res) => {
        bot.processUpdate(req.body);
        res.sendStatus(200);
      });
    }

    app.listen(PORT, () => {
      console.log(`Server listening on port ${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start app:", err);
    process.exit(1);
  }
}

start();
