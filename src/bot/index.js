const TelegramBot = require("node-telegram-bot-api");
const { Op } = require("sequelize");
const { Student, Grade } = require("../models");

const ADMIN_IDS = (process.env.ADMIN_TELEGRAM_IDS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

let cachedBotUsername = null;

// Store admin registration state and grade entry state
const adminRegistrationState = new Map();
const gradeEntryState = new Map();
const deleteGradeState = new Map();

function isAdmin(telegramId) {
  return ADMIN_IDS.includes(String(telegramId));
}

async function getBotUsername(bot) {
  if (cachedBotUsername) return cachedBotUsername;
  try {
    const me = await bot.getMe();
    cachedBotUsername = me.username;
  } catch (err) {
    console.error("Could not fetch bot username:", err.message);
  }
  return cachedBotUsername;
}

function createBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is not set in environment variables");
  }

  const useWebhook = !!process.env.WEBHOOK_URL;
  const bot = new TelegramBot(token, { polling: !useWebhook });

  if (useWebhook) {
    const webhookPath = `/webhook/${token}`;
    const fullUrl = `${process.env.WEBHOOK_URL.replace(/\/$/, "")}${webhookPath}`;
    bot
      .setWebHook(fullUrl)
      .then(() => console.log(`Webhook set to ${fullUrl}`))
      .catch((err) => console.error("Failed to set webhook:", err.message));
  } else {
    console.log("Bot running in polling mode (local development)");
  }

  getBotUsername(bot);
  registerHandlers(bot);
  return bot;
}

function registerHandlers(bot) {
  // ---- /start ----
  bot.onText(/^\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = String(msg.from.id);
    const username = msg.from.username;

    try {
      let student = await Student.findOne({ where: { telegramId } });

      if (student) {
        // User already has telegram ID linked
        if (student.role === "admin") {
          return showAdminMenu(bot, chatId);
        } else {
          return showStudentMenu(bot, chatId);
        }
      }

      // Check if this username is registered in the system
      if (!username) {
        return bot.sendMessage(
          chatId,
          "⚠️ You need a Telegram username to use this bot. Set one in your Telegram settings first.",
        );
      }

      student = await Student.findOne({ where: { username } });

      if (!student) {
        return bot.sendMessage(
          chatId,
          `⚠️ Your username @${username} is not registered. Ask the admin to register you first.`,
        );
      }

      // Link the telegram ID to this registered student
      await student.update({ telegramId });

      if (student.role === "admin") {
        bot.sendMessage(
          chatId,
          `✅ Welcome, Admin! Your account is now linked.`,
        );
        return showAdminMenu(bot, chatId);
      } else {
        bot.sendMessage(
          chatId,
          `✅ Welcome, ${student.fullName}! Your account is now linked.`,
        );
        return showStudentMenu(bot, chatId);
      }
    } catch (err) {
      console.error(err);
      bot.sendMessage(
        chatId,
        "⚠️ Something went wrong. Please try again later.",
      );
    }
  });

  // Show admin menu
  async function showAdminMenu(bot, chatId) {
    const keyboard = {
      inline_keyboard: [
        [{ text: "➕ Register Student", callback_data: "admin_register" }],
        [{ text: "📋 List Students", callback_data: "admin_list" }],
        [{ text: "➕ Add/Edit Grades", callback_data: "admin_add_grades" }],
        [{ text: "📊 View All Grades", callback_data: "admin_view_grades" }],
        [{ text: "🗑️ Delete Grades", callback_data: "admin_delete_grades" }],
      ],
    };
    return bot.sendMessage(
      chatId,
      "👋 Welcome, Admin!\n\nUse the buttons below to manage students and grades.",
      { reply_markup: keyboard },
    );
  }

  // Show student menu
  async function showStudentMenu(bot, chatId) {
    const keyboard = {
      inline_keyboard: [
        [{ text: "📊 My Grades", callback_data: "student_grades" }],
      ],
    };
    return bot.sendMessage(
      chatId,
      "👋 Welcome!\n\nTap the button to view your grades.",
      { reply_markup: keyboard },
    );
  }

  // ---- /help ----
  bot.onText(/^\/help/, (msg) => {
    const chatId = msg.chat.id;
    const text =
      "*Available commands*\n\n/start – Login and see your menu\n/help – Show this message";
    bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
  });

  // ---- /registerform (admin only) ----
  bot.onText(/^\/registerform/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = String(msg.from.id);

    if (!isAdmin(telegramId)) {
      return bot.sendMessage(chatId, "⛔ Admin only command.");
    }

    adminRegistrationState.set(chatId, { step: "name" });
    bot.sendMessage(
      chatId,
      "📝 Register a new student.\n\nEnter their full name:",
    );
  });

  // Handle text input for student registration and grade entry
  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = String(msg.from.id);
    const text = msg.text;

    if (!text || text.startsWith("/")) {
      return;
    }

    // Handle grade entry
    if (gradeEntryState.has(chatId)) {
      const state = gradeEntryState.get(chatId);

      try {
        if (state.step === "enter_subject") {
          state.subject = text.trim();
          state.step = "select_student_button";
          gradeEntryState.set(chatId, state);

          // Get all students and their current grades for this subject
          const students = await Student.findAll({
            where: { role: "student" },
            order: [["fullName", "ASC"]],
          });

          // Build list with current scores
          const studentGrades = await Promise.all(
            students.map(async (s) => {
              const grade = await Grade.findOne({
                where: { studentId: s.id, subject: state.subject },
              });
              return { student: s, grade };
            }),
          );

          state.studentsList = studentGrades;

          // Calculate statistics
          const totalStudents = studentGrades.length;
          const studentsWithGrade = studentGrades.filter(
            (sg) => sg.grade,
          ).length;
          const studentsPending = totalStudents - studentsWithGrade;

          // Create inline buttons in 2-column grid
          const keyboard = {
            inline_keyboard: [],
          };

          // Build 2-column grid (2 buttons per row)
          for (let i = 0; i < studentGrades.length; i += 2) {
            const row = [];

            // First button
            const sg1 = studentGrades[i];
            const score1 = sg1.grade ? sg1.grade.score : "—";
            row.push({
              text: `${sg1.student.fullName}\n${score1}`,
              callback_data: `grade_student_${i}`,
            });

            // Second button (if exists)
            if (i + 1 < studentGrades.length) {
              const sg2 = studentGrades[i + 1];
              const score2 = sg2.grade ? sg2.grade.score : "—";
              row.push({
                text: `${sg2.student.fullName}\n${score2}`,
                callback_data: `grade_student_${i + 1}`,
              });
            }

            keyboard.inline_keyboard.push(row);
          }

          // Add back button
          keyboard.inline_keyboard.push([
            { text: "🔙 Back to Menu", callback_data: "back_to_admin_menu" },
          ]);

          // Store the message ID for later editing
          state.messageId = msg.message_id;

          const statsMessage = `✅ *Subject Selected: ${state.subject}*\n\n� *Progress:*\n• Total Students: ${totalStudents}\n• Grades Entered: ${studentsWithGrade}\n• Pending: ${studentsPending}\n\n📋 Select a student to enter their grade:`;

          return bot.sendMessage(chatId, statsMessage, {
            reply_markup: keyboard,
            parse_mode: "Markdown",
          });
        }

        if (state.step === "enter_student_score") {
          state.score = text.trim();

          // Save or update the grade
          const [grade, created] = await Grade.findOrCreate({
            where: {
              studentId: state.selectedStudent.id,
              subject: state.subject,
            },
            defaults: { score: state.score },
          });

          if (!created) {
            await grade.update({ score: state.score });
          }

          // Notify student if linked
          if (state.selectedStudent.telegramId) {
            bot
              .sendMessage(
                state.selectedStudent.telegramId,
                `📢 Your *${state.subject}* score is now: *${state.score}*`,
                { parse_mode: "Markdown" },
              )
              .catch(() => {});
          }

          // Refresh student list with updated grades
          const studentGrades = await Promise.all(
            state.studentsList.map(async (sg) => {
              const gradeRecord = await Grade.findOne({
                where: { studentId: sg.student.id, subject: state.subject },
              });
              return { student: sg.student, grade: gradeRecord };
            }),
          );

          state.studentsList = studentGrades;
          state.step = "select_student_button";
          gradeEntryState.set(chatId, state);

          // Create updated keyboard
          const keyboard = {
            inline_keyboard: [],
          };

          for (let i = 0; i < studentGrades.length; i += 2) {
            const row = [];

            const sg1 = studentGrades[i];
            const score1 = sg1.grade ? sg1.grade.score : "—";
            row.push({
              text: `${sg1.student.fullName}\n${score1}`,
              callback_data: `grade_student_${i}`,
            });

            if (i + 1 < studentGrades.length) {
              const sg2 = studentGrades[i + 1];
              const score2 = sg2.grade ? sg2.grade.score : "—";
              row.push({
                text: `${sg2.student.fullName}\n${score2}`,
                callback_data: `grade_student_${i + 1}`,
              });
            }

            keyboard.inline_keyboard.push(row);
          }

          // Add back button
          keyboard.inline_keyboard.push([
            { text: "🔙 Back to Menu", callback_data: "back_to_admin_menu" },
          ]);

          bot.sendMessage(
            chatId,
            `✅ *Grade Entered Successfully!*\n\n👤 Student: *${state.selectedStudent.fullName}*\n📚 Subject: *${state.subject}*\n📊 Score: *${state.score}*\n\n📋 Select another student or go back to menu:`,
            {
              reply_markup: keyboard,
              parse_mode: "Markdown",
            },
          );
        }
      } catch (err) {
        console.error(err);
        bot.sendMessage(chatId, "⚠️ Error: " + err.message);
        gradeEntryState.delete(chatId);
      }
      return;
    }

    // Handle student registration
    if (!isAdmin(telegramId) || !adminRegistrationState.has(chatId)) {
      return;
    }

    const state = adminRegistrationState.get(chatId);

    try {
      if (state.step === "name") {
        state.fullName = text.trim();
        state.step = "username";
        adminRegistrationState.set(chatId, state);
        return bot.sendMessage(
          chatId,
          "Enter their Telegram username (without @):",
        );
      }

      if (state.step === "username") {
        let username = text.trim();
        if (username.startsWith("@")) {
          username = username.substring(1);
        }

        // Check if username already exists
        const existing = await Student.findOne({ where: { username } });
        if (existing) {
          return bot.sendMessage(
            chatId,
            "⚠️ This username is already registered. Try another one.",
          );
        }

        // Create the student
        const student = await Student.create({
          fullName: state.fullName,
          username,
          role: "student",
        });

        bot.sendMessage(
          chatId,
          `✅ Student *${student.fullName}* registered with username @${username}.\n\nThey can now send /start to link their account.`,
          { parse_mode: "Markdown" },
        );

        adminRegistrationState.delete(chatId);
      }
    } catch (err) {
      console.error(err);
      bot.sendMessage(chatId, "⚠️ Error: " + err.message);
      adminRegistrationState.delete(chatId);
    }
  });

  // ---- Callback handlers ----
  bot.on("callback_query", async (query) => {
    const chatId = query.message.chat.id;
    const telegramId = String(query.from.id);
    const data = query.data;

    try {
      const student = await Student.findOne({ where: { telegramId } });

      if (!student) {
        return bot.answerCallbackQuery(query.id, {
          text: "⚠️ Not registered",
          show_alert: true,
        });
      }

      // Admin buttons
      if (data === "admin_register" && student.role === "admin") {
        adminRegistrationState.set(chatId, { step: "name" });
        await bot.editMessageText(
          "📝 Register a new student.\n\nEnter their full name:",
          {
            chat_id: chatId,
            message_id: query.message.message_id,
          },
        );
      } else if (data === "admin_list" && student.role === "admin") {
        const students = await Student.findAll({
          order: [["createdAt", "ASC"]],
        });
        const totalStudents = students.length;
        const linkedStudents = students.filter((s) => s.telegramId).length;
        const unlinkedStudents = totalStudents - linkedStudents;

        const lines = students.map((s) => {
          const status = s.telegramId ? "✅ linked" : "⏳ not linked";
          const role = s.role === "admin" ? " 🛡️" : "";
          return `• ${s.fullName}${role} (@${s.username}) - ${status}`;
        });

        const header = `👥 *Students List*\n\n📊 *Summary:*\n• Total: ${totalStudents}\n• Linked: ${linkedStudents}\n• Pending: ${unlinkedStudents}\n\n`;

        await bot.editMessageText(`${header}${lines.join("\n")}`, {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: "Markdown",
        });
      } else if (data === "admin_add_grades" && student.role === "admin") {
        gradeEntryState.set(chatId, {
          step: "enter_subject",
        });

        await bot.editMessageText(
          "📝 *Enter Subject Name*\n\nType the name of the course (e.g., MET-1, MET-2,..):",
          {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: "Markdown",
          },
        );
      } else if (data === "back_to_admin_menu") {
        gradeEntryState.delete(chatId);
        return showAdminMenu(bot, chatId);
      } else if (data === "admin_view_grades" && student.role === "admin") {
        try {
          // Get all grades grouped by subject
          const allGrades = await Grade.findAll({
            include: [{ model: Student, attributes: ["fullName", "id"] }],
            order: [
              ["subject", "ASC"],
              ["createdAt", "DESC"],
            ],
          });

          if (!allGrades.length) {
            await bot.editMessageText("📭 No grades recorded yet.", {
              chat_id: chatId,
              message_id: query.message.message_id,
            });
            return;
          }

          // Group grades by subject
          const gradesBySubject = {};
          allGrades.forEach((grade) => {
            if (!gradesBySubject[grade.subject]) {
              gradesBySubject[grade.subject] = [];
            }
            gradesBySubject[grade.subject].push(grade);
          });

          // Build message with subjects, grades, and entered grade counts
          let message = "📊 *All Grades By Subject*\n\n";
          Object.entries(gradesBySubject).forEach(([subject, grades]) => {
            const enteredCount = grades.length;
            message += `*${subject}* — *${enteredCount}* students grade have been entered.\n`;
            grades.forEach((grade) => {
              message += `  • ${grade.Student.fullName}: ${grade.score}\n`;
            });
            message += "\n";
          });

          await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: "Markdown",
          });
        } catch (err) {
          console.error(err);
          await bot.answerCallbackQuery(query.id, {
            text: "⚠️ Error loading grades",
            show_alert: true,
          });
        }
      } else if (data === "admin_grade_stats" && student.role === "admin") {
        try {
          // Get total students count
          const totalStudents = await Student.count({
            where: { role: "student" },
          });

          if (totalStudents === 0) {
            await bot.editMessageText("📭 No students registered yet.", {
              chat_id: chatId,
              message_id: query.message.message_id,
            });
            return;
          }

          // Get all unique subjects with statistics
          const subjects = await Grade.findAll({
            attributes: ["subject"],
            group: ["subject"],
            order: [["subject", "ASC"]],
            raw: true,
          });

          if (subjects.length === 0) {
            await bot.editMessageText(
              `📈 *Grade Statistics*\n\n👥 Total Students: *${totalStudents}*\n📭 No grades entered yet.`,
              {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: "Markdown",
              },
            );
            return;
          }

          // Calculate statistics for each subject
          let message = `📈 *Grade Statistics*\n\n👥 Total Students: *${totalStudents}*\n\n`;

          for (const subjectRow of subjects) {
            const subject = subjectRow.subject;

            // Count students with grades for this subject
            const studentsWithGrades = await Grade.count({
              where: { subject },
            });

            const studentsWithoutGrades = totalStudents - studentsWithGrades;
            const percentage = Math.round(
              (studentsWithGrades / totalStudents) * 100,
            );

            message += `📚 *${subject}*\n`;
            message += `  ✅ With grades: *${studentsWithGrades}* (${percentage}%)\n`;
            message += `  ⏳ Pending: *${studentsWithoutGrades}* (${100 - percentage}%)\n\n`;
          }

          // Add back button
          const keyboard = {
            inline_keyboard: [
              [
                {
                  text: "🔙 Back to Menu",
                  callback_data: "back_to_admin_menu",
                },
              ],
            ],
          };

          await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: "Markdown",
            reply_markup: keyboard,
          });
        } catch (err) {
          console.error(err);
          await bot.answerCallbackQuery(query.id, {
            text: "⚠️ Error loading statistics",
            show_alert: true,
          });
        }
      } else if (data === "admin_delete_grades" && student.role === "admin") {
        try {
          // Get all unique subjects
          const allGrades = await Grade.findAll({
            attributes: ["subject"],
            group: ["subject"],
            order: [["subject", "ASC"]],
            raw: true,
          });

          if (!allGrades.length) {
            await bot.editMessageText("📭 No grades to delete.", {
              chat_id: chatId,
              message_id: query.message.message_id,
            });
            return;
          }

          // Create buttons for each subject
          const keyboard = {
            inline_keyboard: allGrades.map((g) => [
              {
                text: `${g.subject}`,
                callback_data: `delete_subject_${g.subject}`,
              },
            ]),
          };

          deleteGradeState.set(chatId, { step: "select_subject" });

          await bot.editMessageText(
            "🗑️ *Delete Grades*\n\nSelect a subject to delete grades from:",
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              reply_markup: keyboard,
              parse_mode: "Markdown",
            },
          );
        } catch (err) {
          console.error(err);
          await bot.answerCallbackQuery(query.id, {
            text: "⚠️ Error loading subjects",
            show_alert: true,
          });
        }
      } else if (
        data.startsWith("delete_subject_") &&
        student.role === "admin"
      ) {
        try {
          const subject = data.replace("delete_subject_", "");
          const state = deleteGradeState.get(chatId) || {};
          state.deleteSubject = subject;
          state.step = "select_student_delete";
          deleteGradeState.set(chatId, state);

          // Get all students with grades in this subject
          const grades = await Grade.findAll({
            where: { subject },
            include: [{ model: Student, attributes: ["id", "fullName"] }],
            order: [["Student", "fullName", "ASC"]],
          });

          if (!grades.length) {
            await bot.answerCallbackQuery(query.id, {
              text: "No grades in this subject",
              show_alert: true,
            });
            return;
          }

          // Create buttons for each student with grade in this subject
          const keyboard = {
            inline_keyboard: grades.map((g, index) => [
              {
                text: `${g.Student.fullName} (${g.score})`,
                callback_data: `delete_grade_${index}`,
              },
            ]),
          };

          state.gradesInSubject = grades;
          deleteGradeState.set(chatId, state);

          keyboard.inline_keyboard.push([
            { text: "🔙 Back", callback_data: "admin_delete_grades" },
          ]);

          await bot.editMessageText(
            `🗑️ *Delete from ${subject}*\n\nSelect a student grade to delete:`,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              reply_markup: keyboard,
              parse_mode: "Markdown",
            },
          );
        } catch (err) {
          console.error(err);
          await bot.answerCallbackQuery(query.id, {
            text: "⚠️ Error loading students",
            show_alert: true,
          });
        }
      } else if (data.startsWith("delete_grade_") && student.role === "admin") {
        try {
          const state = deleteGradeState.get(chatId);
          const index = parseInt(data.replace("delete_grade_", ""));

          if (state && state.gradesInSubject && state.gradesInSubject[index]) {
            const gradeToDelete = state.gradesInSubject[index];
            const studentName = gradeToDelete.Student.fullName;
            const subject = gradeToDelete.subject;
            const score = gradeToDelete.score;

            // Delete the grade
            await Grade.destroy({
              where: {
                id: gradeToDelete.id,
              },
            });

            // Notify student if linked
            if (gradeToDelete.Student.telegramId) {
              bot
                .sendMessage(
                  gradeToDelete.Student.telegramId,
                  `⚠️ Your *${subject}* grade (${score}) has been deleted by admin.`,
                  { parse_mode: "Markdown" },
                )
                .catch(() => {});
            }

            await bot.editMessageText(
              `✅ *Grade Deleted Successfully!*\n\n👤 Student: *${studentName}*\n📚 Subject: *${subject}*\n📊 Score: *${score}*\n\n🗑️ Select another grade to delete or go back.`,
              {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: "Markdown",
              },
            );

            // Reset to subject selection
            state.step = "select_subject";
            state.gradesInSubject = null;
            deleteGradeState.set(chatId, state);

            // Show subjects again after brief delay
            setTimeout(async () => {
              const allGrades = await Grade.findAll({
                attributes: ["subject"],
                group: ["subject"],
                order: [["subject", "ASC"]],
                raw: true,
              });

              if (allGrades.length) {
                const keyboard = {
                  inline_keyboard: allGrades.map((g) => [
                    {
                      text: `${g.subject}`,
                      callback_data: `delete_subject_${g.subject}`,
                    },
                  ]),
                };

                keyboard.inline_keyboard.push([
                  {
                    text: "🔙 Back to Menu",
                    callback_data: "back_to_admin_menu",
                  },
                ]);

                await bot.sendMessage(
                  chatId,
                  "🗑️ *Delete Grades*\n\nSelect another subject or go back:",
                  {
                    reply_markup: keyboard,
                    parse_mode: "Markdown",
                  },
                );
              } else {
                await bot.sendMessage(chatId, "📭 No more grades to delete.");
              }
            }, 1000);
          }
        } catch (err) {
          console.error(err);
          await bot.answerCallbackQuery(query.id, {
            text: "⚠️ Error deleting grade",
            show_alert: true,
          });
        }
      } else if (
        data.startsWith("grade_student_") &&
        student.role === "admin"
      ) {
        const state = gradeEntryState.get(chatId);
        const index = parseInt(data.replace("grade_student_", ""));

        if (state && state.studentsList && state.studentsList[index]) {
          state.selectedStudent = state.studentsList[index].student;
          state.step = "enter_student_score";
          gradeEntryState.set(chatId, state);

          await bot.editMessageText(
            `Enter score for *${state.selectedStudent.fullName}* (${state.subject}):`,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: "Markdown",
            },
          );
        }
      } else if (data === "student_grades" && student.role === "student") {
        const grades = await Grade.findAll({
          where: { studentId: student.id },
          order: [["createdAt", "DESC"]],
        });

        if (!grades.length) {
          await bot.editMessageText("📭 No grades recorded yet.", {
            chat_id: chatId,
            message_id: query.message.message_id,
          });
          return;
        }

        const lines = grades.map((g) => `• *${g.subject}*: ${g.score}`);

        await bot.editMessageText(`📊 *Your grades:*\n\n${lines.join("\n")}`, {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: "Markdown",
        });
      }

      bot.answerCallbackQuery(query.id);
    } catch (err) {
      console.error(err);
      bot.answerCallbackQuery(query.id, { text: "⚠️ Error", show_alert: true });
    }
  });

  // ---- /liststudents (admin only) ----
  bot.onText(/^\/liststudents/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = String(msg.from.id);

    if (!isAdmin(telegramId)) {
      return bot.sendMessage(chatId, "⛔ Admin only.");
    }

    try {
      const students = await Student.findAll({ order: [["createdAt", "ASC"]] });
      const lines = students.map((s) => {
        const status = s.telegramId ? "✅" : "⏳";
        return `${status} ${s.fullName} (@${s.username})`;
      });

      bot.sendMessage(chatId, `👥 *Students:*\n\n${lines.join("\n")}`, {
        parse_mode: "Markdown",
      });
    } catch (err) {
      console.error(err);
      bot.sendMessage(chatId, "⚠️ Error");
    }
  });
}

module.exports = { createBot, isAdmin };
