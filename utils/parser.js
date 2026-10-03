const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

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

// Chuyển đổi số tiền có hỗ trợ dấu âm (dùng khi chỉnh sửa số dư quỹ, VD: -700k hoặc 500k)
function parseSignedAmount(amountStr) {
  if (typeof amountStr === 'number') return amountStr;
  if (!amountStr) return 0;
  const isNegative = amountStr.toString().trim().startsWith('-');
  const absVal = parseAmount(amountStr);
  return isNegative ? -absVal : absVal;
}

// Kiểm tra xem 1 chuỗi có phải là số tiền hay không
function isAmountString(str) {
  if (!str) return false;
  const s = str.trim().toLowerCase().replace(/[+-\s₫đvnd]/g, '');
  if (str.includes('/')) return false;
  return /^\d+(\.\d+)?(k|tr|trieu|triệu|m|b|ty|tỷ)?$/i.test(s) || /^\d{1,3}(\.\d{3})+$/.test(s);
}

// Chuẩn hóa và nhận diện các tag chính: Tiêu dùng, Tiết kiệm, Phát sinh, Trả nợ
function normalizeTag(str) {
  if (!str) return null;
  const clean = str.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // bỏ dấu tiếng Việt để so sánh
  
  if (clean === 'tieu dung' || clean === 'td' || clean === 'tieu' || clean === 'chi tieu' || clean === 'spending') {
    return 'Tiêu dùng';
  }
  if (clean === 'tiet kiem' || clean === 'tk' || clean === 'tiet' || clean === 'saving') {
    return 'Tiết kiệm';
  }
  if (clean === 'phat sinh' || clean === 'ps' || clean === 'phat' || clean === 'extra') {
    return 'Phát sinh';
  }
  if (clean === 'tra no' || clean === 'trano' || clean === 'no' || clean === 'debt' || clean === 'tra') {
    return 'Trả nợ';
  }
  return null;
}

// Phân tích thời gian tương tự như cú pháp deadline (VD: 15/30, 15/30/+1, 15/30/02/10)
function parseDateTime(timeStr) {
  if (!timeStr || !timeStr.includes('/')) return null;

  const timeParts = timeStr.trim().split('/');
  if (timeParts.length < 2) return null;

  const hour = parseInt(timeParts[0]);
  const minute = parseInt(timeParts[1]);
  if (isNaN(hour) || isNaN(minute)) return null;

  let targetDate = dayjs().tz("Asia/Ho_Chi_Minh");

  if (timeParts.length === 2) {
    // giờ/phút hôm nay
    targetDate = targetDate.hour(hour).minute(minute).second(0).millisecond(0);
  } else if (timeParts.length === 3 && timeParts[2].startsWith('+')) {
    // giờ/phút/+N ngày
    const addDays = parseInt(timeParts[2].replace('+', ''));
    targetDate = targetDate.add(addDays, 'day').hour(hour).minute(minute).second(0).millisecond(0);
  } else if (timeParts.length >= 4) {
    // giờ/phút/ngày/tháng hoặc giờ/phút/ngày/tháng/năm
    const day = parseInt(timeParts[2]);
    const month = parseInt(timeParts[3]) - 1;
    const year = timeParts.length === 5 ? parseInt(timeParts[4]) : targetDate.year();
    targetDate = targetDate.year(year).month(month).date(day).hour(hour).minute(minute).second(0).millisecond(0);
  }

  return targetDate.isValid() ? targetDate.valueOf() : null;
}

/**
 * Phân tích tin nhắn Quản lý tiền bạc:
 * Cú pháp: +/-số tiền, tag, nội dung(tùy chọn), thời gian(tùy chọn)
 * Quy tắc:
 * 1. Các quỹ: "Tiêu dùng", "Tiết kiệm", "Phát sinh", "Trả nợ".
 * 2. Khi không nhập tag nào trong các tag:
 *    - Nếu là '+' -> tự động cộng vào quỹ Tiết kiệm
 *    - Nếu là '-' -> tự động trừ vào quỹ Tiêu dùng
 * 3. Nội dung và Thời gian là tùy chọn.
 */
function parseFinanceMessage(text) {
  if (!text || typeof text !== 'string') return null;

  const rawParts = text.split(',').map(p => p.trim()).filter(Boolean);
  if (rawParts.length === 0) return null;

  let type = null; // 'income' (+) hoặc 'expense' (-)
  let amount = 0;
  let remainingParts = [];

  // 1. Kiểm tra phần đầu tiên hoặc bất kỳ phần nào có dấu +/- kèm số tiền
  const firstMatch = rawParts[0].match(/^([+-])\s*(\d+[a-zA-Z\d\.]*)$/);
  if (firstMatch) {
    type = firstMatch[1] === '+' ? 'income' : 'expense';
    amount = parseAmount(firstMatch[2]);
    remainingParts = rawParts.slice(1);
  } 
  else if ((rawParts[0] === '+' || rawParts[0] === '-') && rawParts[1] && isAmountString(rawParts[1])) {
    type = rawParts[0] === '+' ? 'income' : 'expense';
    amount = parseAmount(rawParts[1]);
    remainingParts = rawParts.slice(2);
  }
  else {
    const signedIndex = rawParts.findIndex(p => {
      const s = p.trim();
      return (s.startsWith('+') || s.startsWith('-')) && isAmountString(s);
    });

    if (signedIndex !== -1) {
      const signedStr = rawParts[signedIndex].trim();
      type = signedStr.startsWith('+') ? 'income' : 'expense';
      amount = parseAmount(signedStr);
      remainingParts = rawParts.filter((_, idx) => idx !== signedIndex);
    }
  }

  // Nếu không phát hiện dấu + hay - hợp lệ kèm số tiền thì đây không phải tin nhắn tiền bạc
  if (!type || amount <= 0) {
    return null;
  }

  // 2. Phân tích các phần còn lại để trích xuất Tag, Thời gian, và Nội dung
  let matchedFund = null;
  let transactionTime = Date.now();
  let descParts = [];

  for (const part of remainingParts) {
    // Ktra có phải là 1 trong các Tag không
    const tag = normalizeTag(part);
    if (tag && !matchedFund) {
      matchedFund = tag;
      continue;
    }

    // Ktra có phải là chuỗi thời gian không (VD: 12/00, 15/30/02/10)
    const timeVal = parseDateTime(part);
    if (timeVal !== null) {
      transactionTime = timeVal;
      continue;
    }

    // Nếu không phải Tag và không phải Thời gian -> Nội dung
    descParts.push(part);
  }

  // 3. Quy tắc mặc định quỹ khi không có tag:
  // Nếu không nhập tag: '+' vào Tiết kiệm, '-' vào Tiêu dùng
  let fundName = matchedFund;
  if (!fundName) {
    fundName = (type === 'income') ? 'Tiết kiệm' : 'Tiêu dùng';
  }

  // 4. Nội dung (Description)
  let description = descParts.join(', ').trim();
  if (!description) {
    if (matchedFund) {
      description = (type === 'income' ? 'Thu nhập ' : 'Chi tiêu ') + matchedFund;
    } else {
      description = (type === 'income' ? 'Cộng tiền tiết kiệm' : 'Chi tiêu tiêu dùng');
    }
  }

  return {
    isFinance: true,
    type,
    amount,
    description,
    fundName,
    transactionTime
  };
}

// Phân tích tin nhắn Deadline (giữ nguyên hoạt động cũ)
function parseMessage(text) {
  const parts = text.split(',').map(p => p.trim());
  if (parts.length < 2) {
    throw new Error('Sai định dạng. Vui lòng nhập: Nội dung, thời gian, [trước bao lâu]');
  }

  const title = parts[0];
  const timeStr = parts[1];
  const remindStr = parts[2] || '0p'; 

  const timeParts = timeStr.split('/');
  if (timeParts.length < 2) {
    throw new Error('Định dạng thời gian sai. Ít nhất phải có giờ/phút');
  }

  const hour = parseInt(timeParts[0]);
  const minute = parseInt(timeParts[1]);
  
  // Lấy thời gian hiện tại chuẩn giờ Việt Nam
  let targetDate = dayjs().tz("Asia/Ho_Chi_Minh");

  if (timeParts.length === 2) {
    // Format: giờ/phút -> mặc định ngày hôm nay
    targetDate = targetDate.hour(hour).minute(minute).second(0).millisecond(0);
  } 
  else if (timeParts.length === 3 && timeParts[2].startsWith('+')) {
    // Format: giờ/phút/+1 -> cộng thêm số ngày
    const addDays = parseInt(timeParts[2].replace('+', ''));
    targetDate = targetDate.add(addDays, 'day').hour(hour).minute(minute).second(0).millisecond(0);
  }
  else if (timeParts.length >= 4) {
    // Format: giờ/phút/ngày/tháng hoặc giờ/phút/ngày/tháng/năm
    const day = parseInt(timeParts[2]);
    const month = parseInt(timeParts[3]) - 1; // JS month 0-11
    const year = timeParts.length === 5 ? parseInt(timeParts[4]) : targetDate.year();
    
    targetDate = targetDate.year(year).month(month).date(day).hour(hour).minute(minute).second(0).millisecond(0);
  }

  if (!targetDate.isValid()) {
    throw new Error('Ngày giờ không hợp lệ.');
  }

  // Tính số phút nhắc trước
  let remind_before_minutes = 0;
  const regex = /(\d+)\s*([dhp])/g;
  let match;
  while ((match = regex.exec(remindStr.toLowerCase())) !== null) {
    const val = parseInt(match[1]);
    const unit = match[2];
    if (unit === 'd') remind_before_minutes += val * 24 * 60;
    else if (unit === 'h') remind_before_minutes += val * 60;
    else if (unit === 'p') remind_before_minutes += val;
  }

  return {
    title,
    deadline_time: targetDate.valueOf(), 
    remind_before_minutes
  };
}

function formatTime(timestamp) {
  return dayjs(timestamp).tz("Asia/Ho_Chi_Minh").format('HH:mm DD/MM/YYYY');
}

function formatMoney(amount) {
  const num = Number(amount) || 0;
  const sign = num < 0 ? '-' : '';
  return sign + Math.abs(num).toLocaleString('vi-VN') + ' đ';
}

module.exports = {
  parseMessage,
  parseFinanceMessage,
  parseAmount,
  parseSignedAmount,
  parseDateTime,
  normalizeTag,
  formatTime,
  formatMoney
};
