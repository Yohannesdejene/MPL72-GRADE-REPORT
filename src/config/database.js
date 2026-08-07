require("dotenv").config();
const { Sequelize } = require("sequelize");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set in environment variables");
}

const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: "postgres",
  protocol: "postgres",
  logging: false,
  dialectOptions: {
    ssl: {
      require: true,
      // Neon uses a trusted cert, but this keeps things working
      // across various hosting/proxy setups.
      rejectUnauthorized: false,
    },
  },
});

module.exports = sequelize;
