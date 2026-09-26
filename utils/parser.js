const dayjs = require('dayjs');

// Parse tin nhắn Telegram theo format:
// Nội dung, giờ/phút/ngày/tháng, thời_gian_nhắc_trước
// Ví dụ: Họp team, 15/30/26/09, 1h 30p
function parseMessage(text) {
  const parts = text.split(',').map(p => p.trim());
  if (parts.length < 2) {
    throw new Error('Sai định dạng. Vui lòng nhập: Nội dung, giờ/phút/ngày/tháng, [trước bao lâu]');
  }

  const title = parts[0];
  const timeStr = parts[1];
  const remindStr = parts[2] || '0p'; // Mặc định báo đúng giờ

  // Xử lý thời gian
  // Hỗ trợ giờ/phút/ngày/tháng hoặc giờ/phút/ngày/tháng/năm
  const timeParts = timeStr.split('/');
  if (timeParts.length < 4) {
    throw new Error('Định dạng thời gian sai. Dùng: giờ/phút/ngày/tháng');
  }

  const hour = parseInt(timeParts[0]);
  const minute = parseInt(timeParts[1]);
  const day = parseInt(timeParts[2]);
  const month = parseInt(timeParts[3]) - 1; // Month trong JS bắt đầu từ 0
  
  // Tự động lấy năm hiện tại từ hệ thống, hoặc lấy từ input nếu người dùng có nhập (năm ở vị trí 4)
  const year = timeParts.length === 5 ? parseInt(timeParts[4]) : new Date().getFullYear();

  const deadlineDate = new Date(year, month, day, hour, minute, 0);
  if (isNaN(deadlineDate.getTime())) {
    throw new Error('Ngày giờ không hợp lệ.');
  }

  // Xử lý chuỗi nhắc trước (VD: 1d 2h 30p -> thành tổng số phút)
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
    deadline_time: deadlineDate.getTime(),
    remind_before_minutes
  };
}

// Hàm format thời gian để hiển thị
function formatTime(timestamp) {
  return dayjs(timestamp).format('HH:mm DD/MM/YYYY');
}

module.exports = {
  parseMessage,
  formatTime
};
