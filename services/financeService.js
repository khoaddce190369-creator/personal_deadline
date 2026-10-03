const db = require('../db/database');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const { parseSignedAmount } = require('../utils/parser');

dayjs.extend(utc);
dayjs.extend(timezone);

const STANDARD_FUNDS = {
  SPENDING: 'Tiêu dùng',
  EXTRA: 'Phát sinh',
  DEBT: 'Trả nợ',
  SAVINGS: 'Tiết kiệm'
};

const WEEKLY_ALLOWANCES = {
  [STANDARD_FUNDS.SPENDING]: 500000, // 500k / tuần
  [STANDARD_FUNDS.EXTRA]: 100000     // 100k / tuần
};

const MONTHLY_ALLOWANCES = {
  [STANDARD_FUNDS.DEBT]: -700000     // -700k / tháng
};

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

// Lấy key tháng hiện tại (vd: 2026-10)
function getCurrentMonthKey() {
  return dayjs().tz('Asia/Ho_Chi_Minh').format('YYYY-MM');
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

// Định dạng tiền tệ hiển thị đẹp mắt (50,000 đ hoặc -700,000 đ)
function formatMoney(amount) {
  const num = Number(amount) || 0;
  const sign = num < 0 ? '-' : '';
  return sign + Math.abs(num).toLocaleString('vi-VN') + ' đ';
}

/**
 * Đảm bảo user có ĐỦ 4 QUỸ và tự động xử lý kết chuyển tuần/tháng:
 * 1. Tiêu dùng: 500k/tuần, hết tuần dư bao nhiêu chuyển sang Tiết kiệm, reset lại 500k.
 * 2. Phát sinh: 100k/tuần, hết tuần dư bao nhiêu chuyển sang Tiết kiệm, reset lại 100k.
 * 3. Trả nợ: Mỗi tháng sẽ là -700k (-700.000 đ).
 * 4. Tiết kiệm: Nhận tiền dư chuyển sang và tiền nạp, tích lũy không reset.
 */
async function ensureUserFundsAndRollover(chatId) {
  const { weekKey } = getCurrentWeekRange();
  const monthKey = getCurrentMonthKey();

  // 1. Dọn dẹp các quỹ cũ không thuộc 4 quỹ chuẩn (nếu có từ trước)
  const allFundsRes = await db.execute({
    sql: `SELECT * FROM funds WHERE chat_id = ?`,
    args: [chatId]
  });

  const existingFundsMap = new Map();
  for (const row of allFundsRes.rows) {
    if (
      row.name === STANDARD_FUNDS.SPENDING ||
      row.name === STANDARD_FUNDS.EXTRA ||
      row.name === STANDARD_FUNDS.DEBT ||
      row.name === STANDARD_FUNDS.SAVINGS
    ) {
      existingFundsMap.set(row.name, row);
    } else {
      await db.execute({
        sql: `DELETE FROM funds WHERE id = ? AND chat_id = ?`,
        args: [row.id, chatId]
      });
    }
  }

  // 2. Tạo 4 quỹ chuẩn nếu chưa tồn tại
  if (!existingFundsMap.has(STANDARD_FUNDS.SPENDING)) {
    await db.execute({
      sql: `INSERT INTO funds (chat_id, name, balance, created_at) VALUES (?, ?, ?, ?)`,
      args: [chatId, STANDARD_FUNDS.SPENDING, WEEKLY_ALLOWANCES[STANDARD_FUNDS.SPENDING], Date.now()]
    });
  }
  if (!existingFundsMap.has(STANDARD_FUNDS.EXTRA)) {
    await db.execute({
      sql: `INSERT INTO funds (chat_id, name, balance, created_at) VALUES (?, ?, ?, ?)`,
      args: [chatId, STANDARD_FUNDS.EXTRA, WEEKLY_ALLOWANCES[STANDARD_FUNDS.EXTRA], Date.now()]
    });
  }
  if (!existingFundsMap.has(STANDARD_FUNDS.DEBT)) {
    await db.execute({
      sql: `INSERT INTO funds (chat_id, name, balance, created_at) VALUES (?, ?, ?, ?)`,
      args: [chatId, STANDARD_FUNDS.DEBT, MONTHLY_ALLOWANCES[STANDARD_FUNDS.DEBT], Date.now()]
    });
  }
  if (!existingFundsMap.has(STANDARD_FUNDS.SAVINGS)) {
    await db.execute({
      sql: `INSERT INTO funds (chat_id, name, balance, created_at) VALUES (?, ?, ?, ?)`,
      args: [chatId, STANDARD_FUNDS.SAVINGS, 0, Date.now()]
    });
  }

  // 3. Kiểm tra chu kỳ tuần và tháng trong `user_finance_state`
  const stateRes = await db.execute({
    sql: `SELECT * FROM user_finance_state WHERE chat_id = ?`,
    args: [chatId]
  });

  if (stateRes.rows.length === 0) {
    // Lần đầu khởi tạo
    await db.execute({
      sql: `INSERT INTO user_finance_state (chat_id, last_week_key, last_month_key, updated_at) VALUES (?, ?, ?, ?)`,
      args: [chatId, weekKey, monthKey, Date.now()]
    });
    return { rolledOverWeek: false, rolledOverMonth: false };
  }

  const userState = stateRes.rows[0];
  let rolledOverWeek = false;
  let rolledOverMonth = false;

  // A. XỬ LÝ TUẦN MỚI CHO TIÊU DÙNG VÀ PHÁT SINH
  if (userState.last_week_key !== weekKey) {
    const prevWeek = userState.last_week_key;

    const spendingRes = await db.execute({
      sql: `SELECT balance FROM funds WHERE chat_id = ? AND name = ?`,
      args: [chatId, STANDARD_FUNDS.SPENDING]
    });
    const extraRes = await db.execute({
      sql: `SELECT balance FROM funds WHERE chat_id = ? AND name = ?`,
      args: [chatId, STANDARD_FUNDS.EXTRA]
    });

    const spendingBal = spendingRes.rows[0] ? Number(spendingRes.rows[0].balance) : 0;
    const extraBal = extraRes.rows[0] ? Number(extraRes.rows[0].balance) : 0;

    // Kết chuyển tiền dư Quỹ Tiêu dùng sang Tiết kiệm (nếu dư > 0)
    if (spendingBal > 0) {
      await db.execute({
        sql: `UPDATE funds SET balance = balance + ? WHERE chat_id = ? AND name = ?`,
        args: [spendingBal, chatId, STANDARD_FUNDS.SAVINGS]
      });
      await db.execute({
        sql: `INSERT INTO transactions (chat_id, type, amount, description, fund_name, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        args: [
          chatId,
          'income',
          spendingBal,
          `Dư tuần ${prevWeek} (Quỹ Tiêu dùng -> Tiết kiệm)`,
          STANDARD_FUNDS.SAVINGS,
          Date.now()
        ]
      });
    }

    // Kết chuyển tiền dư Quỹ Phát sinh sang Tiết kiệm (nếu dư > 0)
    if (extraBal > 0) {
      await db.execute({
        sql: `UPDATE funds SET balance = balance + ? WHERE chat_id = ? AND name = ?`,
        args: [extraBal, chatId, STANDARD_FUNDS.SAVINGS]
      });
      await db.execute({
        sql: `INSERT INTO transactions (chat_id, type, amount, description, fund_name, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        args: [
          chatId,
          'income',
          extraBal,
          `Dư tuần ${prevWeek} (Quỹ Phát sinh -> Tiết kiệm)`,
          STANDARD_FUNDS.SAVINGS,
          Date.now()
        ]
      });
    }

    // Reset lại 2 quỹ theo định mức tuần mới
    await db.execute({
      sql: `UPDATE funds SET balance = ? WHERE chat_id = ? AND name = ?`,
      args: [WEEKLY_ALLOWANCES[STANDARD_FUNDS.SPENDING], chatId, STANDARD_FUNDS.SPENDING]
    });
    await db.execute({
      sql: `UPDATE funds SET balance = ? WHERE chat_id = ? AND name = ?`,
      args: [WEEKLY_ALLOWANCES[STANDARD_FUNDS.EXTRA], chatId, STANDARD_FUNDS.EXTRA]
    });

    await db.execute({
      sql: `UPDATE user_finance_state SET last_week_key = ?, updated_at = ? WHERE chat_id = ?`,
      args: [weekKey, Date.now(), chatId]
    });

    rolledOverWeek = true;
  }

  // B. XỬ LÝ THÁNG MỚI CHO QUỸ TRẢ NỢ (Mỗi tháng là -700k)
  if (userState.last_month_key !== monthKey) {
    await db.execute({
      sql: `UPDATE funds SET balance = ? WHERE chat_id = ? AND name = ?`,
      args: [MONTHLY_ALLOWANCES[STANDARD_FUNDS.DEBT], chatId, STANDARD_FUNDS.DEBT]
    });

    await db.execute({
      sql: `INSERT INTO transactions (chat_id, type, amount, description, fund_name, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        chatId,
        'expense',
        Math.abs(MONTHLY_ALLOWANCES[STANDARD_FUNDS.DEBT]),
        `Định mức trả nợ tháng ${monthKey}`,
        STANDARD_FUNDS.DEBT,
        Date.now()
      ]
    });

    await db.execute({
      sql: `UPDATE user_finance_state SET last_month_key = ?, updated_at = ? WHERE chat_id = ?`,
      args: [monthKey, Date.now(), chatId]
    });

    rolledOverMonth = true;
  }

  return { rolledOverWeek, rolledOverMonth };
}

// Kiểm tra rollover cho tất cả các user (dành cho cron job chạy ngầm định kỳ)
async function checkAllUsersWeeklyRollover() {
  const usersRes = await db.execute(`SELECT chat_id FROM allowed_users`);
  for (const user of usersRes.rows) {
    try {
      await ensureUserFundsAndRollover(user.chat_id);
    } catch (err) {
      console.error(`Lỗi rollover cho user ${user.chat_id}:`, err.message);
    }
  }
}

// Lấy danh sách 4 quỹ
async function getFunds(chatId) {
  await ensureUserFundsAndRollover(chatId);

  const res = await db.execute({
    sql: `SELECT * FROM funds WHERE chat_id = ? ORDER BY 
          CASE name 
            WHEN 'Tiêu dùng' THEN 1 
            WHEN 'Phát sinh' THEN 2 
            WHEN 'Trả nợ' THEN 3
            WHEN 'Tiết kiệm' THEN 4 
            ELSE 5 
          END ASC`,
    args: [chatId]
  });

  return res.rows;
}

// Chỉnh sửa số dư của bất kỳ quỹ nào qua Web
async function updateFundBalance(chatId, fundIdentifier, newBalanceStr) {
  await ensureUserFundsAndRollover(chatId);

  const newBalance = parseSignedAmount(newBalanceStr);

  // Tìm quỹ theo id hoặc tên
  let fundRes = await db.execute({
    sql: `SELECT * FROM funds WHERE chat_id = ? AND (id = ? OR name = ?)`,
    args: [chatId, fundIdentifier, fundIdentifier]
  });

  if (fundRes.rows.length === 0) {
    throw new Error('Không tìm thấy quỹ cần chỉnh sửa');
  }

  const fund = fundRes.rows[0];
  const oldBalance = Number(fund.balance);

  // Cập nhật số dư mới
  await db.execute({
    sql: `UPDATE funds SET balance = ? WHERE id = ? AND chat_id = ?`,
    args: [newBalance, fund.id, chatId]
  });

  // Ghi lại vết giao dịch điều chỉnh
  const delta = newBalance - oldBalance;
  await db.execute({
    sql: `INSERT INTO transactions (chat_id, type, amount, description, fund_name, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      chatId,
      delta >= 0 ? 'income' : 'expense',
      Math.abs(delta),
      `Điều chỉnh số dư quỹ ${fund.name} (${formatMoney(oldBalance)} -> ${formatMoney(newBalance)})`,
      fund.name,
      Date.now()
    ]
  });

  const overview = await getOverview(chatId);
  return {
    success: true,
    fund: { ...fund, balance: newBalance },
    overview
  };
}

// Thêm một giao dịch (Thu / Chi)
async function addTransaction(chatId, { type, amount, description, fundName, transactionTime }) {
  await ensureUserFundsAndRollover(chatId);

  const transType = (type === 'income' || type === '+') ? 'income' : 'expense';
  const parsedAmt = parseAmount(amount);
  const time = transactionTime ? Number(transactionTime) : Date.now();

  if (parsedAmt <= 0) {
    throw new Error('Số tiền phải lớn hơn 0');
  }

  // Chuẩn hóa tên quỹ
  let targetFundName = fundName;
  if (
    targetFundName !== STANDARD_FUNDS.SPENDING &&
    targetFundName !== STANDARD_FUNDS.EXTRA &&
    targetFundName !== STANDARD_FUNDS.DEBT &&
    targetFundName !== STANDARD_FUNDS.SAVINGS
  ) {
    targetFundName = transType === 'income' ? STANDARD_FUNDS.SAVINGS : STANDARD_FUNDS.SPENDING;
  }

  const desc = (description || (transType === 'income' ? 'Thu nhập ' + targetFundName : 'Chi tiêu ' + targetFundName)).trim();

  // Lưu giao dịch vào database
  const insertRes = await db.execute({
    sql: `INSERT INTO transactions (chat_id, type, amount, description, fund_name, created_at) 
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [chatId, transType, parsedAmt, desc, targetFundName, time]
  });

  // Cập nhật số dư của Quỹ
  const balanceDelta = transType === 'income' ? parsedAmt : -parsedAmt;
  await db.execute({
    sql: `UPDATE funds SET balance = balance + ? WHERE chat_id = ? AND name = ?`,
    args: [balanceDelta, chatId, targetFundName]
  });

  // Lấy số dư mới của quỹ vừa thao tác
  const updatedFundRes = await db.execute({
    sql: `SELECT balance FROM funds WHERE chat_id = ? AND name = ?`,
    args: [chatId, targetFundName]
  });
  const newFundBalance = updatedFundRes.rows[0] ? Number(updatedFundRes.rows[0].balance) : 0;

  // Lấy tổng quan sau khi thêm giao dịch
  const overview = await getOverview(chatId);

  return {
    id: insertRes.lastInsertRowid,
    chat_id: chatId,
    type: transType,
    amount: parsedAmt,
    description: desc,
    fund_name: targetFundName,
    created_at: time,
    fund_balance: newFundBalance,
    total_balance: overview.totalBalance,
    remaining_week: overview.remainingWeek
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
  
  // Hoàn tiền lại cho quỹ
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

// Lấy tổng quan tài chính cho user
async function getOverview(chatId) {
  const funds = await getFunds(chatId);
  const totalBalance = funds.reduce((sum, f) => sum + Number(f.balance || 0), 0);

  const spendingFund = funds.find(f => f.name === STANDARD_FUNDS.SPENDING);
  const extraFund = funds.find(f => f.name === STANDARD_FUNDS.EXTRA);
  const debtFund = funds.find(f => f.name === STANDARD_FUNDS.DEBT);
  const savingsFund = funds.find(f => f.name === STANDARD_FUNDS.SAVINGS);

  const spendingBalance = spendingFund ? Number(spendingFund.balance) : 0;
  const extraBalance = extraFund ? Number(extraFund.balance) : 0;
  const debtBalance = debtFund ? Number(debtFund.balance) : 0;
  const savingsBalance = savingsFund ? Number(savingsFund.balance) : 0;

  // Hạn mức chi tiêu tuần cố định: 500k (Tiêu dùng) + 100k (Phát sinh) = 600k
  const weeklyBudget = WEEKLY_ALLOWANCES[STANDARD_FUNDS.SPENDING] + WEEKLY_ALLOWANCES[STANDARD_FUNDS.EXTRA];
  
  // Số tiền còn lại trong tuần của 2 quỹ chi tiêu (Tiêu dùng + Phát sinh)
  const remainingWeek = spendingBalance + extraBalance;

  // Tổng tiền đã chi tiêu trong tuần
  const { startOfWeek, endOfWeek } = getCurrentWeekRange();
  const spentRes = await db.execute({
    sql: `SELECT SUM(amount) as total_spent FROM transactions 
          WHERE chat_id = ? AND type = 'expense' AND created_at >= ? AND created_at <= ?`,
    args: [chatId, startOfWeek, endOfWeek]
  });
  const spentThisWeek = (spentRes.rows[0] && spentRes.rows[0].total_spent) ? Number(spentRes.rows[0].total_spent) : 0;

  const weekInfo = getCurrentWeekRange();
  const recentTransactions = await getTransactions(chatId, { limit: 30 });

  return {
    totalBalance,
    weeklyBudget,
    spentThisWeek,
    remainingWeek,
    spendingBalance,
    extraBalance,
    debtBalance,
    savingsBalance,
    funds,
    recentTransactions,
    weekInfo
  };
}

module.exports = {
  STANDARD_FUNDS,
  WEEKLY_ALLOWANCES,
  MONTHLY_ALLOWANCES,
  getCurrentWeekRange,
  getCurrentMonthKey,
  parseAmount,
  formatMoney,
  ensureUserFundsAndRollover,
  checkAllUsersWeeklyRollover,
  getFunds,
  updateFundBalance,
  addTransaction,
  deleteTransaction,
  getTransactions,
  getOverview
};
