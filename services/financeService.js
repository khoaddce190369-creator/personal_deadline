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
  [STANDARD_FUNDS.SPENDING]: 300000, // 300k / tuần (ăn uống)
  [STANDARD_FUNDS.EXTRA]: 200000     // 200k / tuần (giặt đồ, xăng xe, mua lặt vặt)
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

// Bộ nhớ đệm trạng thái khởi tạo người dùng để giảm bớt truy vấn Turso cloud
const userInitializedMap = new Map();

function invalidateUserInitCache(chatId) {
  if (chatId) {
    userInitializedMap.delete(chatId.toString());
  } else {
    userInitializedMap.clear();
  }
}

/**
 * Đảm bảo user có ĐỦ 4 QUỸ và tự động xử lý kết chuyển tuần/tháng:
 * 1. Tiêu dùng: 300k/tuần (ăn uống), hết tuần dư bao nhiêu chuyển sang Tiết kiệm, reset lại 300k.
 * 2. Phát sinh: 200k/tuần (giặt đồ, xăng xe, mua lặt vặt), hết tuần dư bao nhiêu chuyển sang Tiết kiệm, reset lại 200k.
 * 3. Trả nợ: Mỗi tháng sẽ là -700k (-700.000 đ).
 * 4. Tiết kiệm: Nhận tiền dư chuyển sang và tiền nạp, tích lũy không reset.
 */
async function ensureUserFundsAndRollover(chatId) {
  const { weekKey } = getCurrentWeekRange();
  const monthKey = getCurrentMonthKey();
  const cacheKey = chatId.toString();

  const cached = userInitializedMap.get(cacheKey);
  if (
    cached &&
    cached.weekKey === weekKey &&
    cached.monthKey === monthKey &&
    Date.now() - cached.timestamp < 10 * 60 * 1000 // 10 phút
  ) {
    return { rolledOverWeek: false, rolledOverMonth: false };
  }

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
      sql: `INSERT INTO user_finance_state (chat_id, last_week_key, last_month_key, total_money, updated_at) VALUES (?, ?, ?, ?, ?)`,
      args: [chatId, weekKey, monthKey, 0, Date.now()]
    });
    userInitializedMap.set(cacheKey, { weekKey, monthKey, timestamp: Date.now() });
    return { rolledOverWeek: false, rolledOverMonth: false };
  }

  const userState = stateRes.rows[0];
  if (userState.total_money === null || userState.total_money === undefined) {
    await db.execute({
      sql: `UPDATE user_finance_state SET total_money = 0 WHERE chat_id = ?`,
      args: [chatId]
    });
    userState.total_money = 0;
  }

  // Cập nhật tuần/tháng mới nhất (KHÔNG tự động reset hay chuyển tiền giữa các quỹ, user sẽ tự tay điều chỉnh)
  if (userState.last_week_key !== weekKey || userState.last_month_key !== monthKey) {
    await db.execute({
      sql: `UPDATE user_finance_state SET last_week_key = ?, last_month_key = ?, updated_at = ? WHERE chat_id = ?`,
      args: [weekKey, monthKey, Date.now(), chatId]
    });
  }

  userInitializedMap.set(cacheKey, { weekKey, monthKey, timestamp: Date.now() });
  return { rolledOverWeek: false, rolledOverMonth: false };
}

// Kiểm tra rollover cho tất cả các user (đã tắt tự động hồi hạn mức theo tuần)
async function checkAllUsersWeeklyRollover() {
  // Không tự động can thiệp số dư các quỹ, user chủ động điều chỉnh
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

/**
 * Tính toán mức tác động lên Tổng tiền dựa theo Quỹ và mức biến động của quỹ (fundDelta).
 * 
 * Quy tắc:
 * "Và mọi tác động đến quỹ đều sẽ tác động đến tổng số tiền của tôi
 * (tổng tiền không nhất thiết phải bằng tổng các quỹ cộng lại),
 * khi quỹ nợ được cộng thì tổng tiền sẽ bị trừ"
 * 
 * 1. Quỹ 'Trả nợ':
 *    - Quỹ nợ được cộng (fundDelta > 0, vd: trả nợ) => Tổng tiền BỊ TRỪ (-fundDelta)
 *    - Quỹ nợ bị trừ (fundDelta < 0, vd: vay thêm) => Tổng tiền ĐƯỢC CỘNG (+Math.abs(fundDelta))
 * 2. Các quỹ khác ('Tiêu dùng', 'Phát sinh', 'Tiết kiệm'):
 *    - Quỹ được cộng (fundDelta > 0) => Tổng tiền ĐƯỢC CỘNG (+fundDelta)
 *    - Quỹ bị trừ (fundDelta < 0) => Tổng tiền BỊ TRỪ (-Math.abs(fundDelta))
 */
function calculateTotalMoneyImpact(fundName, fundDelta) {
  if (fundName === STANDARD_FUNDS.DEBT) {
    return -fundDelta;
  }
  return fundDelta;
}

// Lấy số tiền đã chi tuần hiện tại
async function getWeeklySpent(chatId) {
  const { startOfWeek, endOfWeek, weekKey } = getCurrentWeekRange();
  const budgetRes = await db.execute({
    sql: `SELECT amount, spent_override FROM weekly_budgets WHERE chat_id = ? AND (week_key = ? OR week_key = 'default')
          ORDER BY CASE WHEN week_key = ? THEN 1 ELSE 2 END ASC LIMIT 1`,
    args: [chatId, weekKey, weekKey]
  });
  const budgetRow = budgetRes.rows[0];
  if (budgetRow && budgetRow.spent_override !== null && budgetRow.spent_override !== undefined) {
    return Number(budgetRow.spent_override);
  }
  const spentRes = await db.execute({
    sql: `SELECT 
            COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE -amount END), 0) as total_spent 
          FROM transactions 
          WHERE chat_id = ? 
            AND fund_name IN ('Tiêu dùng', 'Phát sinh')
            AND created_at >= ? AND created_at <= ?`,
    args: [chatId, startOfWeek, endOfWeek]
  });
  return Math.max(0, Number(spentRes.rows[0] ? spentRes.rows[0].total_spent : 0));
}

// Lưu số tiền đã chi tuần vào bảng weekly_budgets
async function saveWeeklySpentRecord(chatId, newSpent) {
  const { weekKey } = getCurrentWeekRange();
  const defaultBudget = WEEKLY_ALLOWANCES[STANDARD_FUNDS.SPENDING] + WEEKLY_ALLOWANCES[STANDARD_FUNDS.EXTRA];
  const spent = Math.max(0, Math.round(Number(newSpent) || 0));

  await db.execute({
    sql: `INSERT INTO weekly_budgets (chat_id, week_key, amount, spent_override, created_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(chat_id, week_key) DO UPDATE SET spent_override = excluded.spent_override, created_at = excluded.created_at`,
    args: [chatId, weekKey, defaultBudget, spent, Date.now()]
  });
  return spent;
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
  const delta = newBalance - oldBalance;

  // Cập nhật số dư mới của quỹ
  await db.execute({
    sql: `UPDATE funds SET balance = ? WHERE id = ? AND chat_id = ?`,
    args: [newBalance, fund.id, chatId]
  });

  // Tác động lên Tổng tiền của user
  const totalImpact = calculateTotalMoneyImpact(fund.name, delta);
  if (totalImpact !== 0) {
    await db.execute({
      sql: `UPDATE user_finance_state SET total_money = COALESCE(total_money, 0) + ?, updated_at = ? WHERE chat_id = ?`,
      args: [totalImpact, Date.now(), chatId]
    });
  }

  // Quỹ Tiêu dùng hoặc Phát sinh giảm bao nhiêu thì thanh tiến độ tăng bấy nhiêu, quỹ tăng bao nhiêu thì tiến độ giảm bấy nhiêu
  if (fund.name === STANDARD_FUNDS.SPENDING || fund.name === STANDARD_FUNDS.EXTRA) {
    const { weekKey } = getCurrentWeekRange();
    const budgetRes = await db.execute({
      sql: `SELECT spent_override FROM weekly_budgets WHERE chat_id = ? AND week_key = ?`,
      args: [chatId, weekKey]
    });
    const budgetRow = budgetRes.rows[0];
    if (budgetRow && budgetRow.spent_override !== null && budgetRow.spent_override !== undefined) {
      const currentOverride = Number(budgetRow.spent_override);
      const newOverride = Math.max(0, currentOverride - delta);
      await saveWeeklySpentRecord(chatId, newOverride);
    }
  }

  // Ghi lại vết giao dịch điều chỉnh
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

// Chỉnh sửa tổng số tiền trực tiếp qua Web
async function updateTotalMoney(chatId, newAmountStr) {
  await ensureUserFundsAndRollover(chatId);

  const newAmount = parseSignedAmount(newAmountStr);

  const stateRes = await db.execute({
    sql: `SELECT total_money FROM user_finance_state WHERE chat_id = ?`,
    args: [chatId]
  });
  const oldAmount = stateRes.rows[0] ? Number(stateRes.rows[0].total_money || 0) : 0;

  await db.execute({
    sql: `UPDATE user_finance_state SET total_money = ?, updated_at = ? WHERE chat_id = ?`,
    args: [newAmount, Date.now(), chatId]
  });

  const delta = newAmount - oldAmount;
  if (delta !== 0) {
    await db.execute({
      sql: `INSERT INTO transactions (chat_id, type, amount, description, fund_name, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        chatId,
        delta >= 0 ? 'income' : 'expense',
        Math.abs(delta),
        `Điều chỉnh tổng số tiền (${formatMoney(oldAmount)} -> ${formatMoney(newAmount)})`,
        'Tổng tiền',
        Date.now()
      ]
    });
  }

  const overview = await getOverview(chatId);
  return {
    success: true,
    totalBalance: newAmount,
    overview
  };
}

// Cài đặt / Chỉnh sửa hạn mức chi tiêu tuần trực tiếp qua Web
async function setWeeklyBudget(chatId, amountStr) {
  await ensureUserFundsAndRollover(chatId);
  const amount = parseAmount(amountStr);
  if (amount <= 0) {
    throw new Error('Hạn mức tuần phải lớn hơn 0');
  }

  const { weekKey } = getCurrentWeekRange();

  // Lưu hạn mức tuần vào bảng weekly_budgets
  await db.execute({
    sql: `INSERT INTO weekly_budgets (chat_id, week_key, amount, created_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(chat_id, week_key) DO UPDATE SET amount = excluded.amount, created_at = excluded.created_at`,
    args: [chatId, weekKey, amount, Date.now()]
  });

  const overview = await getOverview(chatId);
  return {
    success: true,
    weeklyBudget: amount,
    overview
  };
}

// Cài đặt / Điều chỉnh số tiền đã chi tiêu tuần này (kéo thanh tiến độ tuần)
async function setWeeklySpent(chatId, spentStr) {
  await ensureUserFundsAndRollover(chatId);
  const spent = parseAmount(spentStr);
  if (spent < 0) {
    throw new Error('Số tiền chi tiêu không hợp lệ');
  }

  const oldSpent = await getWeeklySpent(chatId);
  const diff = spent - oldSpent;

  // Lưu số tiền đã chi mới
  await saveWeeklySpentRecord(chatId, spent);

  // Khi thanh tiến độ thay đổi: số tiền trong quỹ Tiêu dùng cũng phải thay đổi theo!
  // Thanh tiến độ tăng (diff > 0): số tiền trong quỹ Tiêu dùng GIẢM theo diff
  // Thanh tiến độ giảm (diff < 0): số tiền trong quỹ Tiêu dùng TĂNG theo |diff|
  if (diff !== 0) {
    const spendingRes = await db.execute({
      sql: `SELECT * FROM funds WHERE chat_id = ? AND name = ?`,
      args: [chatId, STANDARD_FUNDS.SPENDING]
    });

    if (spendingRes.rows.length > 0) {
      const spendingFund = spendingRes.rows[0];
      const oldFundBal = Number(spendingFund.balance);
      const newFundBal = oldFundBal - diff;

      await db.execute({
        sql: `UPDATE funds SET balance = ? WHERE id = ? AND chat_id = ?`,
        args: [newFundBal, spendingFund.id, chatId]
      });

      // Tác động lên Tổng tiền (quỹ giảm thì tổng tiền giảm, quỹ tăng thì tổng tiền tăng)
      await db.execute({
        sql: `UPDATE user_finance_state SET total_money = COALESCE(total_money, 0) - ?, updated_at = ? WHERE chat_id = ?`,
        args: [diff, Date.now(), chatId]
      });

      // Ghi vết giao dịch điều chỉnh
      await db.execute({
        sql: `INSERT INTO transactions (chat_id, type, amount, description, fund_name, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        args: [
          chatId,
          diff > 0 ? 'expense' : 'income',
          Math.abs(diff),
          `Điều chỉnh chi tiêu tuần (${formatMoney(oldSpent)} -> ${formatMoney(spent)})`,
          STANDARD_FUNDS.SPENDING,
          Date.now()
        ]
      });
    }
  }

  const overview = await getOverview(chatId);
  return {
    success: true,
    spentThisWeek: spent,
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

  // Cập nhật Tổng tiền theo tác động của Quỹ (khi quỹ nợ cộng thì tổng tiền trừ, v.v.)
  const totalImpact = calculateTotalMoneyImpact(targetFundName, balanceDelta);
  if (totalImpact !== 0) {
    await db.execute({
      sql: `UPDATE user_finance_state SET total_money = COALESCE(total_money, 0) + ?, updated_at = ? WHERE chat_id = ?`,
      args: [totalImpact, Date.now(), chatId]
    });
  }

  // Lấy số dư mới của quỹ vừa thao tác
  const updatedFundRes = await db.execute({
    sql: `SELECT balance FROM funds WHERE chat_id = ? AND name = ?`,
    args: [chatId, targetFundName]
  });
  const newFundBalance = updatedFundRes.rows[0] ? Number(updatedFundRes.rows[0].balance) : 0;

  // Cập nhật số tiền đã chi tuần (nếu user đang có override thủ công)
  if (targetFundName === STANDARD_FUNDS.SPENDING || targetFundName === STANDARD_FUNDS.EXTRA) {
    const { weekKey } = getCurrentWeekRange();
    const budgetRes = await db.execute({
      sql: `SELECT spent_override FROM weekly_budgets WHERE chat_id = ? AND week_key = ?`,
      args: [chatId, weekKey]
    });
    const budgetRow = budgetRes.rows[0];
    if (budgetRow && budgetRow.spent_override !== null && budgetRow.spent_override !== undefined) {
      const currentOverride = Number(budgetRow.spent_override);
      const newOverride = transType === 'expense'
        ? currentOverride + parsedAmt
        : Math.max(0, currentOverride - parsedAmt);
      await saveWeeklySpentRecord(chatId, newOverride);
    }
  }

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

// Xóa giao dịch (hoàn lại số dư quỹ tương ứng và hoàn tác tác động lên tổng tiền)
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

  // Hoàn tác tác động lên Tổng tiền
  const totalImpact = calculateTotalMoneyImpact(tx.fund_name, refundDelta);
  if (totalImpact !== 0) {
    await db.execute({
      sql: `UPDATE user_finance_state SET total_money = COALESCE(total_money, 0) + ?, updated_at = ? WHERE chat_id = ?`,
      args: [totalImpact, Date.now(), chatId]
    });
  }

  // Cập nhật lại số tiền đã chi tuần (nếu user đang có override thủ công)
  if (tx.fund_name === STANDARD_FUNDS.SPENDING || tx.fund_name === STANDARD_FUNDS.EXTRA) {
    const { weekKey } = getCurrentWeekRange();
    const budgetRes = await db.execute({
      sql: `SELECT spent_override FROM weekly_budgets WHERE chat_id = ? AND week_key = ?`,
      args: [chatId, weekKey]
    });
    const budgetRow = budgetRes.rows[0];
    if (budgetRow && budgetRow.spent_override !== null && budgetRow.spent_override !== undefined) {
      const currentOverride = Number(budgetRow.spent_override);
      const newOverride = tx.type === 'expense'
        ? Math.max(0, currentOverride - tx.amount)
        : currentOverride + tx.amount;
      await saveWeeklySpentRecord(chatId, newOverride);
    }
  }

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

// Lấy tổng quan tài chính cho user (đã tối ưu 1 đợt db.batch siêu tốc)
async function getOverview(chatId) {
  await ensureUserFundsAndRollover(chatId);

  const weekInfo = getCurrentWeekRange();
  const { startOfWeek, endOfWeek, weekKey } = weekInfo;
  const defaultBudget = WEEKLY_ALLOWANCES[STANDARD_FUNDS.SPENDING] + WEEKLY_ALLOWANCES[STANDARD_FUNDS.EXTRA];

  // Thực thi đồng thời 5 truy vấn bằng duy nhất 1 kết nối db.batch lên cloud Turso
  const batchRes = await db.batch([
    // 0: Danh sách 4 quỹ chuẩn đã sắp xếp thứ tự
    {
      sql: `SELECT * FROM funds WHERE chat_id = ? ORDER BY 
            CASE name 
              WHEN 'Tiêu dùng' THEN 1 
              WHEN 'Phát sinh' THEN 2 
              WHEN 'Trả nợ' THEN 3 
              WHEN 'Tiết kiệm' THEN 4 
              ELSE 5 
            END ASC`,
      args: [chatId]
    },
    // 1: Tổng số tiền thực tế
    {
      sql: `SELECT total_money FROM user_finance_state WHERE chat_id = ?`,
      args: [chatId]
    },
    // 2: Hạn mức tuần & spent_override
    {
      sql: `SELECT amount, spent_override FROM weekly_budgets WHERE chat_id = ? AND (week_key = ? OR week_key = 'default')
            ORDER BY CASE WHEN week_key = ? THEN 1 ELSE 2 END ASC LIMIT 1`,
      args: [chatId, weekKey, weekKey]
    },
    // 3: Tổng chi tiêu tính từ giao dịch
    {
      sql: `SELECT 
              COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE -amount END), 0) as total_spent 
            FROM transactions 
            WHERE chat_id = ? 
              AND fund_name IN ('Tiêu dùng', 'Phát sinh')
              AND created_at >= ? AND created_at <= ?`,
      args: [chatId, startOfWeek, endOfWeek]
    },
    // 4: Lịch sử giao dịch gần nhất (30 dòng)
    {
      sql: `SELECT * FROM transactions WHERE chat_id = ? ORDER BY created_at DESC LIMIT 30`,
      args: [chatId]
    }
  ]);

  const funds = batchRes[0].rows;
  const totalBalance = batchRes[1].rows[0] ? Number(batchRes[1].rows[0].total_money || 0) : 0;
  const budgetRow = batchRes[2].rows[0];
  const weeklyBudget = (budgetRow && budgetRow.amount) ? Number(budgetRow.amount) : defaultBudget;

  let spentThisWeek = 0;
  if (budgetRow && budgetRow.spent_override !== null && budgetRow.spent_override !== undefined) {
    spentThisWeek = Number(budgetRow.spent_override);
  } else {
    spentThisWeek = Math.max(0, Number(batchRes[3].rows[0] ? batchRes[3].rows[0].total_spent : 0));
  }

  const remainingWeek = weeklyBudget - spentThisWeek;
  const recentTransactions = batchRes[4].rows;

  const spendingFund = funds.find(f => f.name === STANDARD_FUNDS.SPENDING);
  const extraFund = funds.find(f => f.name === STANDARD_FUNDS.EXTRA);
  const debtFund = funds.find(f => f.name === STANDARD_FUNDS.DEBT);
  const savingsFund = funds.find(f => f.name === STANDARD_FUNDS.SAVINGS);

  return {
    totalBalance,
    weeklyBudget,
    spentThisWeek,
    remainingWeek,
    spendingBalance: spendingFund ? Number(spendingFund.balance) : 0,
    extraBalance: extraFund ? Number(extraFund.balance) : 0,
    debtBalance: debtFund ? Number(debtFund.balance) : 0,
    savingsBalance: savingsFund ? Number(savingsFund.balance) : 0,
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
  calculateTotalMoneyImpact,
  ensureUserFundsAndRollover,
  checkAllUsersWeeklyRollover,
  getFunds,
  updateFundBalance,
  updateTotalMoney,
  setWeeklyBudget,
  setWeeklySpent,
  addTransaction,
  deleteTransaction,
  getTransactions,
  getOverview
};
