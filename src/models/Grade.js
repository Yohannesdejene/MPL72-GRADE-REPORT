const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Grade = sequelize.define(
  'Grade',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    subject: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    score: {
      type: DataTypes.STRING, // string so admins can enter "A", "95", "95%", etc.
      allowNull: false,
    },
    term: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    studentId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    enteredByAdminId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  },
  {
    tableName: 'grades',
    timestamps: true,
  }
);

module.exports = Grade;
