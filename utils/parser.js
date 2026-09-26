const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

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

module.exports = {
  parseMessage,
  formatTime
};
