const db = require('../db/database');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

// Lấy thông tin tuần hiện tại (Thứ Hai 00:00:00 -> Chủ Nhật 23:59:59.999 theo múi giờ VN)
function getCurrentWeekRange() {
  const now = dayjs().tz('Asia/Ho_Chi_Minh');
  const dayOfWeek = now.day(); // 0 is Sunday, 1 is Monday...
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const startOfWeek = now.add(diffToMonday, 'day').startOf('day');
  const endOfWeek = startOfWeek.add(6, 'day').endOf('day');
  
  // Format week key: YYYY-Www (vd: 2026-W40)
  const weekNumber = Math.ceil((((startOfWeek - new Date(startOfWeek.year(), 0, 1)) / 86400000) + 1) / 7);
  const weekKey = `${startOfWeek.year()}-W${String(weekNumber).padStart(2, '0')}`;
  
  return {
    startOfWeek: startOfWeek.valueOf(),
    endOfWeek: endOfWeek.valueOf(),
    weekKey,
    label: `${startOfWeek.format('DD/MM')} - ${endOfWeek.format('DD/MM/YYYY')}`
  };
}

// Chuyển đổi chuỗi số tiền thông minh (50k, 1.5tr, 2m, 50000, 50.000)
function parseAmount(amountStr) {
  if (typeof amountStr === 'number') return Math.abs(amountStr);
  if (!amountStr) return 0;
  
  let str = amountStr.toString().trim().toLowerCase();
  str = str.replace(/[+-\s₫đvnd]/g, '');

  let multiplier = 1;
  if (str.endsWith('k')) {
    multiplier = 1000;
    str = str.slice(0, -1);
  } else if (str.endsWith('tr') || str.endsWith('trieu') || str.endsWith('triệu')) {
    multiplier = 1000000;
    str = str.replace(/(tr|trieu|triệu)$/, '');
  } else if (str.endsWith('m')) {
    multiplier = 1000000;
    str = str.slice(0, -1);
  } else if (str.endsWith('b') || str.endsWith('ty') || str.endsWith('tỷ')) {
    multiplier = 1000000000;
    str = str.replace(/(b|ty|tỷ)$/, '');
  }

  // Thay dấu phẩy thập phân nếu có kiểu "1,5tr"
  if (str.includes(',') && !str.includes('.')) {
    str = str.replace(',', '.');
  } else {
    // Loại bỏ dấu chấm ngăn cách hàng nghìn kiểu "50.000"
    if ((str.match(/\./g) || []).length > 1 || (str.includes('.') && str.indexOf('.') === str.length - 4)) {
      str = str.replace(/\./g, '');
    }
  }

  const num = parseFloat(str);
  return isNaN(num) ? 0 : Math.round(num * multiplier);
}

// Định dạng tiền tệ hiển thị đẹp mắt (50,000 đ)
function formatMoney(amount) {
  const num = Number(amount) || 0;
  return num.toLocaleString('vi-VN') + ' đ';
}

// Lấy danh sách các quỹ của người dùng
async function getFunds(chatId) {
  const res = await db.execute({
    sql: `SELECT * FROM funds WHERE chat_id = ? ORDER BY id ASC`,
    args: [chatId]
  });

  // Nếu người dùng chưa có quỹ nào, tạo sẵn 1 Quỹ chung mặc định
  if (res.rows.length === 0) {
    const defaultFund = await createFund(chatId, 'Quỹ chung', 0);
    return [defaultFund];
  }

  return res.rows;
}

// Tạo quỹ mới
async function createFund(chatId, name, initialBalance = 0) {
  const trimmedName = (name || 'Quỹ chung').trim();
  const initBal = parseAmount(initialBalance);

  // Kiểm tra xem quỹ đã tồn tại chưa
  const existing = await db.execute({
    sql: `SELECT * FROM funds WHERE chat_id = ? AND name = ?`,
    args: [chatId, trimmedName]
  });

  if (existing.rows.length > 0) {
    return existing.rows[0];
  }

  const result = await db.execute({
    sql: `INSERT INTO funds (chat_id, name, balance, created_at) VALUES (?, ?, ?, ?)`,
    args: [chatId, trimmedName, initBal, Date.now()]
  });

  return {
    id: result.lastInsertRowid,
    chat_id: chatId,
    name: trimmedName,
    balance: initBal,
    created_at: Date.now()
  };
}

// Xóa quỹ
async function deleteFund(chatId, fundId) {
  await db.execute({
    sql: `DELETE FROM funds WHERE id = ? AND chat_id = ?`,
    args: [fundId, chatId]
  });
  return { success: true };
}

// Cài đặt hạn mức chi tiêu cho tuần
async function setWeeklyBudget(chatId, amount, weekKey = null) {
  const budgetNum = parseAmount(amount);
  const targetWeek = weekKey || getCurrentWeekRange().weekKey;

  // Cập nhật hoặc thêm mới cho tuần chỉ định
  await db.execute({
    sql: `INSERT INTO weekly_budgets (chat_id, week_key, amount, created_at) 
          VALUES (?, ?, ?, ?)
          ON CONFLICT(chat_id, week_key) DO UPDATE SET amount = ?`,
    args: [chatId, targetWeek, budgetNum, Date.now(), budgetNum]
  });

  // Đồng thời lưu làm hạn mức mặc định (default) nếu các tuần sau chưa đặt
  await db.execute({
    sql: `INSERT INTO weekly_budgets (chat_id, week_key, amount, created_at) 
          VALUES (?, 'default', ?, ?)
          ON CONFLICT(chat_id, week_key) DO UPDATE SET amount = ?`,
    args: [chatId, budgetNum, Date.now(), budgetNum]
  });

  return { weekKey: targetWeek, amount: budgetNum };
}

// Lấy hạn mức chi tiêu tuần này
async function getWeeklyBudget(chatId) {
  const { weekKey } = getCurrentWeekRange();
  
  // Ưu tiên tuần hiện tại, nếu chưa có thì lấy 'default'
  const res = await db.execute({
    sql: `SELECT amount FROM weekly_budgets 
          WHERE chat_id = ? AND (week_key = ? OR week_key = 'default')
          ORDER BY CASE WHEN week_key = ? THEN 1 ELSE 2 END LIMIT 1`,
    args: [chatId, weekKey, weekKey]
  });

  return res.rows.length > 0 ? Number(res.rows[0].amount) : 0;
}

// Lấy tổng chi tiêu trong tuần hiện tại
async function getWeeklySpending(chatId) {
  const { startOfWeek, endOfWeek } = getCurrentWeekRange();

  const res = await db.execute({
    sql: `SELECT SUM(amount) as total_spent FROM transactions 
          WHERE chat_id = ? AND type = 'expense' AND created_at >= ? AND created_at <= ?`,
    args: [chatId, startOfWeek, endOfWeek]
  });

  return (res.rows[0] && res.rows[0].total_spent) ? Number(res.rows[0].total_spent) : 0;
}

// Lấy tổng thu nhập trong tuần hiện tại
async function getWeeklyIncome(chatId) {
  const { startOfWeek, endOfWeek } = getCurrentWeekRange();

  const res = await db.execute({
    sql: `SELECT SUM(amount) as total_income FROM transactions 
          WHERE chat_id = ? AND type = 'income' AND created_at >= ? AND created_at <= ?`,
    args: [chatId, startOfWeek, endOfWeek]
  });

  return (res.rows[0] && res.rows[0].total_income) ? Number(res.rows[0].total_income) : 0;
}

// Thêm một giao dịch (Thu / Chi)
async function addTransaction(chatId, { type, amount, description, fundName }) {
  const transType = (type === 'income' || type === '+') ? 'income' : 'expense';
  const parsedAmt = parseAmount(amount);
  const desc = (description || (transType === 'income' ? 'Thu nhập' : 'Chi tiêu')).trim();
  const targetFundName = (fundName || 'Quỹ chung').trim();

  if (parsedAmt <= 0) {
    throw new Error('Số tiền phải lớn hơn 0');
  }

  // Đảm bảo Quỹ đã tồn tại, nếu chưa có thì tạo mới
  let fundRes = await db.execute({
    sql: `SELECT * FROM funds WHERE chat_id = ? AND name = ?`,
    args: [chatId, targetFundName]
  });

  if (fundRes.rows.length === 0) {
    await createFund(chatId, targetFundName, 0);
    fundRes = await db.execute({
      sql: `SELECT * FROM funds WHERE chat_id = ? AND name = ?`,
      args: [chatId, targetFundName]
    });
  }

  const fund = fundRes.rows[0];

  // Lưu giao dịch vào database
  const insertRes = await db.execute({
    sql: `INSERT INTO transactions (chat_id, type, amount, description, fund_name, created_at) 
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [chatId, transType, parsedAmt, desc, targetFundName, Date.now()]
  });

  // Cập nhật số dư của Quỹ
  const balanceDelta = transType === 'income' ? parsedAmt : -parsedAmt;
  await db.execute({
    sql: `UPDATE funds SET balance = balance + ? WHERE chat_id = ? AND name = ?`,
    args: [balanceDelta, chatId, targetFundName]
  });

  // Lấy số dư mới của quỹ
  const updatedFundRes = await db.execute({
    sql: `SELECT balance FROM funds WHERE chat_id = ? AND name = ?`,
    args: [chatId, targetFundName]
  });
  const newFundBalance = updatedFundRes.rows[0] ? Number(updatedFundRes.rows[0].balance) : 0;

  // Lấy thông tin tuần
  const weeklyBudget = await getWeeklyBudget(chatId);
  const spentThisWeek = await getWeeklySpending(chatId);
  const remainingWeek = weeklyBudget - spentThisWeek;

  return {
    id: insertRes.lastInsertRowid,
    chat_id: chatId,
    type: transType,
    amount: parsedAmt,
    description: desc,
    fund_name: targetFundName,
    created_at: Date.now(),
    fund_balance: newFundBalance,
    weekly_budget: weeklyBudget,
    spent_this_week: spentThisWeek,
    remaining_week: remainingWeek
  };
}

// Xóa giao dịch (hoàn lại số dư quỹ tương ứng)
async function deleteTransaction(chatId, transactionId) {
  const transRes = await db.execute({
    sql: `SELECT * FROM transactions WHERE id = ? AND chat_id = ?`,
    args: [transactionId, chatId]
  });

  if (transRes.rows.length === 0) {
    throw new Error('Giao dịch không tồn tại hoặc không thuộc về bạn');
  }

  const tx = transRes.rows[0];
  
  // Hoàn tiền lại cho quỹ: nếu là expense thì cộng lại, nếu là income thì trừ đi
  const refundDelta = tx.type === 'expense' ? tx.amount : -tx.amount;
  await db.execute({
    sql: `UPDATE funds SET balance = balance + ? WHERE chat_id = ? AND name = ?`,
    args: [refundDelta, chatId, tx.fund_name]
  });

  // Xóa giao dịch
  await db.execute({
    sql: `DELETE FROM transactions WHERE id = ? AND chat_id = ?`,
    args: [transactionId, chatId]
  });

  return { success: true };
}

// Lấy danh sách giao dịch
async function getTransactions(chatId, options = {}) {
  const limit = options.limit || 50;
  let sql = `SELECT * FROM transactions WHERE chat_id = ?`;
  const args = [chatId];

  if (options.fund) {
    sql += ` AND fund_name = ?`;
    args.push(options.fund);
  }
  if (options.type) {
    sql += ` AND type = ?`;
    args.push(options.type);
  }
  if (options.weekOnly) {
    const { startOfWeek, endOfWeek } = getCurrentWeekRange();
    sql += ` AND created_at >= ? AND created_at <= ?`;
    args.push(startOfWeek, endOfWeek);
  }

  sql += ` ORDER BY created_at DESC LIMIT ?`;
  args.push(limit);

  const res = await db.execute({ sql, args });
  return res.rows;
}

// Lấy toàn bộ tổng quan tài chính
async function getOverview(chatId) {
  const funds = await getFunds(chatId);
  const totalBalance = funds.reduce((sum, f) => sum + Number(f.balance || 0), 0);
  
  const weeklyBudget = await getWeeklyBudget(chatId);
  const spentThisWeek = await getWeeklySpending(chatId);
  const incomeThisWeek = await getWeeklyIncome(chatId);
  const remainingWeek = weeklyBudget - spentThisWeek;

  const weekInfo = getCurrentWeekRange();
  const recentTransactions = await getTransactions(chatId, { limit: 30 });

  return {
    totalBalance,
    weeklyBudget,
    spentThisWeek,
    incomeThisWeek,
    remainingWeek,
    funds,
    recentTransactions,
    weekInfo
  };
}

module.exports = {
  getCurrentWeekRange,
  parseAmount,
  formatMoney,
  getFunds,
  createFund,
  deleteFund,
  setWeeklyBudget,
  getWeeklyBudget,
  getWeeklySpending,
  getWeeklyIncome,
  addTransaction,
  deleteTransaction,
  getTransactions,
  getOverview
};
