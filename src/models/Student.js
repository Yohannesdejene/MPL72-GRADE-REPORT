const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const Student = sequelize.define(
  "Student",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    fullName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    username: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: true,
    },
    telegramId: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: true,
    },
    role: {
      type: DataTypes.ENUM("admin", "student"),
      allowNull: false,
      defaultValue: "student",
    },
  },
  {
    tableName: "students",
    timestamps: true,
  },
);

module.exports = Student;
