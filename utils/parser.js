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

// Kiểm tra xem 1 chuỗi có phải là số tiền hay không
function isAmountString(str) {
  if (!str) return false;
  const s = str.trim().toLowerCase().replace(/[+-\s₫đvnd]/g, '');
  // Không chứa dấu gạch chéo thời gian (/)
  if (str.includes('/')) return false;
  return /^\d+(\.\d+)?(k|tr|trieu|triệu|m|b|ty|tỷ)?$/i.test(s) || /^\d{1,3}(\.\d{3})+$/.test(s);
}

/**
 * Phân tích tin nhắn Quản lý tiền bạc
 * Cú pháp hỗ trợ các dạng linh hoạt dựa trên cấu trúc cũ (ngăn cách dấu phẩy, thêm trường + hoặc -):
 * - Dạng 1: `+, Số tiền, Nội dung, [Tên quỹ]` hoặc `-, Số tiền, Nội dung, [Tên quỹ]`
 *   VD: `-, 45k, Cơm trưa, Ăn uống`
 * - Dạng 2: `Nội dung, +, Số tiền, [Tên quỹ]` hoặc `Nội dung, -, Số tiền, [Tên quỹ]`
 *   VD: `Cơm trưa, -, 45k, Ăn uống`
 * - Dạng 3: `Nội dung, -Số tiền, [Tên quỹ]` hoặc `Nội dung, +Số tiền, [Tên quỹ]`
 *   VD: `Cơm trưa, -45k, Ăn uống`
 * - Dạng 4: `-, 45k, Cơm trưa` (Quỹ mặc định là 'Quỹ chung')
 */
function parseFinanceMessage(text) {
  if (!text || typeof text !== 'string') return null;

  const rawParts = text.split(',').map(p => p.trim()).filter(Boolean);
  if (rawParts.length < 2) {
    // Trường hợp gõ không dấu phẩy như "+ 50k Cơm trưa" hoặc "- 50k Cơm trưa"
    const spaceMatch = text.trim().match(/^([+-])\s*(\d+[a-zA-Z\d\.]*)\s*(.*)$/);
    if (spaceMatch) {
      const type = spaceMatch[1] === '+' ? 'income' : 'expense';
      const amount = parseAmount(spaceMatch[2]);
      const rest = spaceMatch[3].trim();
      const restParts = rest.split(',').map(p => p.trim()).filter(Boolean);
      const description = restParts[0] || (type === 'income' ? 'Thu nhập' : 'Chi tiêu');
      const fundName = restParts[1] || 'Quỹ chung';
      if (amount > 0) {
        return { isFinance: true, type, amount, description, fundName };
      }
    }
    return null;
  }

  let type = null; // 'income' | 'expense'
  let amount = 0;
  let remainingParts = [];

  // 1. Kiểm tra xem có phần nào là dấu '+' hoặc '-' riêng biệt không
  let signIndex = rawParts.findIndex(p => p === '+' || p === '-');
  if (signIndex !== -1) {
    type = rawParts[signIndex] === '+' ? 'income' : 'expense';
    // Loại bỏ phần dấu
    remainingParts = rawParts.filter((_, idx) => idx !== signIndex);
  } else {
    // 2. Kiểm tra xem có phần nào bắt đầu bằng '+' hoặc '-' kết hợp số tiền không (vd: -45k, +5tr)
    let signedAmountIndex = rawParts.findIndex(p => {
      const s = p.trim();
      return (s.startsWith('+') || s.startsWith('-')) && isAmountString(s) && !s.includes('/');
    });

    if (signedAmountIndex !== -1) {
      const signedStr = rawParts[signedAmountIndex].trim();
      type = signedStr.startsWith('+') ? 'income' : 'expense';
      amount = parseAmount(signedStr);
      remainingParts = rawParts.filter((_, idx) => idx !== signedAmountIndex);
    } else {
      // 3. Kiểm tra trường đầu tiên bắt đầu bằng '+' hoặc '-' (vd: "+ Lương", "- Cơm trưa")
      const firstPart = rawParts[0];
      if (firstPart.startsWith('+') || firstPart.startsWith('-')) {
        type = firstPart.startsWith('+') ? 'income' : 'expense';
        const cleanedFirst = firstPart.substring(1).trim();
        remainingParts = [cleanedFirst, ...rawParts.slice(1)].filter(Boolean);
      }
    }
  }

  // Nếu không phát hiện dấu + hay - nào thì không phải tin nhắn tài chính
  if (!type) {
    return null;
  }

  // 4. Nếu chưa trích xuất được số tiền, tìm trong remainingParts
  if (amount <= 0) {
    const amtIndex = remainingParts.findIndex(p => isAmountString(p));
    if (amtIndex !== -1) {
      amount = parseAmount(remainingParts[amtIndex]);
      remainingParts = remainingParts.filter((_, idx) => idx !== amtIndex);
    }
  }

  if (amount <= 0) {
    throw new Error('Không tìm thấy số tiền hợp lệ. VD: `-, 45k, Cơm trưa, Ăn uống` hoặc `+, 5tr, Lương, Tiết kiệm`');
  }

  // 5. Trích xuất Nội dung (description) và Tên quỹ (fundName)
  const description = remainingParts[0] || (type === 'income' ? 'Thu nhập' : 'Chi tiêu');
  const fundName = remainingParts[1] || 'Quỹ chung';

  return {
    isFinance: true,
    type,
    amount,
    description,
    fundName
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
  return num.toLocaleString('vi-VN') + ' đ';
}

module.exports = {
  parseMessage,
  parseFinanceMessage,
  parseAmount,
  formatTime,
  formatMoney
};
