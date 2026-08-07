const sequelize = require("../config/database");
const Student = require("./Student");
const Grade = require("./Grade");

// A student can have many grades; each grade belongs to one student.
Student.hasMany(Grade, { foreignKey: "studentId", onDelete: "CASCADE" });
Grade.belongsTo(Student, { foreignKey: "studentId" });

module.exports = { sequelize, Student, Grade };
