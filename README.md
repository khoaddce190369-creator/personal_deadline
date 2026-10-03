# Hướng dẫn Deploy NoteDeadLine (Miễn phí 24/7)

## Bước 1: Tạo Bot Telegram
1. Mở Telegram, tìm tài khoản **@BotFather** có dấu tích xanh.
2. Nhắn `/newbot`, nhập Tên bot và Username (phải kết thúc bằng `_bot`, VD: `hacker_note_bot`).
3. BotFather sẽ gửi cho bạn một đoạn Token dài. Copy nó -> Đây là `TELEGRAM_BOT_TOKEN`.
4. Tìm tài khoản **@userinfobot** trên Telegram, bấm Start, nó sẽ gửi ID của bạn (một dãy số). Copy nó -> Đây là `ADMIN_CHAT_ID` (để tránh người lạ dùng bot của bạn).

## Bước 2: Setup Database đám mây (Turso)
1. Vào [turso.tech](https://turso.tech), bấm **Log in** và đăng nhập bằng GitHub (Rất nhanh, không cần thẻ Visa).
2. Ở màn hình chính (Dashboard), bấm **Create Database**, đặt tên là `notedeadline` rồi tạo.
3. Tạo xong, bấm vào tên Database đó. Bạn sẽ thấy cái **URL** (bắt đầu bằng `libsql://...`). Copy nó -> Đây là `DB_URL`.
4. Nhìn sang góc phải màn hình của Database đó, có nút **Generate Token**. Bấm vào, copy dãy mã rất dài đó -> Đây là `DB_AUTH_TOKEN`.

## Bước 3: Đưa code lên Render
1. Push toàn bộ thư mục code này (trừ thư mục `node_modules`) lên **GitHub** của bạn.
2. Vào [render.com](https://render.com), đăng nhập bằng GitHub.
3. Bấm nút **New +** ở góc phải trên cùng -> Chọn **Web Service**.
4. Chọn kết nối với kho code GitHub của bạn.
5. Cấu hình cơ bản:
   - Name: `note-deadline-app`
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Free Tier
6. Kéo xuống mục **Environment Variables** (Biến môi trường) và thêm 4 dòng tương ứng với 4 thứ bạn vừa copy ở Bước 1 & Bước 2:
   - `TELEGRAM_BOT_TOKEN` = (Token của Bot)
   - `ADMIN_CHAT_ID` = (ID của bạn)
   - `DB_URL` = (Link libsql của Turso)
   - `DB_AUTH_TOKEN` = (Token của Turso)
7. Bấm **Create Web Service**. Chờ 2-3 phút để Render chạy. Khi thấy chữ `Live` màu xanh lá là thành công! Copy lại cái link web của bạn (VD: `https://note-deadline-app.onrender.com`).

## Bước 4: Chống ngủ cho Render bằng cron-job.org
1. Vào [cron-job.org](https://cron-job.org), đăng ký tài khoản miễn phí.
2. Đăng nhập xong, bấm **CREATE CRONJOB**.
3. Điền thông tin:
   - Title: `Keep Render Alive`
   - URL: Dán link Render của bạn vào và thêm `/api/ping` ở cuối. (VD: `https://note-deadline-app.onrender.com/api/ping`).
   - Execution schedule: Chọn **Every 14 minutes** (14 phút 1 lần).
4. Bấm **CREATE**.

Xong! Hệ thống của bạn đã chạy 24/7 hoàn toàn tự động và miễn phí.

---

## Quản lý Tài chính Cá nhân (Hệ thống 4 Quỹ & Tự động kết chuyển chu kỳ)

### 1. Quy tắc 4 Quỹ:
1. **Quỹ Tiêu dùng** (Tag `tiêu dùng`): Cấp **500.000 đ / tuần**. Hết tuần tự động reset lại 500k, tiền còn dư tuần đó được tự động cộng dồn vào **Quỹ Tiết kiệm**.
2. **Quỹ Phát sinh** (Tag `phát sinh`): Cấp **100.000 đ / tuần** (dành cho gym, việc đột xuất...). Hết tuần tự động reset lại 100k, tiền còn dư tự động chuyển vào **Quỹ Tiết kiệm**.
3. **Quỹ Trả nợ** (Tag `trả nợ` / `tra no` / `no`): Mỗi tháng định mức ban đầu là **-700.000 đ / tháng**. Hết tháng reset về -700k. Có thể trả nợ bằng tin nhắn `+số tiền, trả nợ`.
4. **Quỹ Tiết kiệm** (Tag `tiết kiệm`): Tích lũy liên tục (nhận tiền nạp trực tiếp & tiền dư từ các quỹ tuần cũ).

---

### 2. Cú pháp gửi tin nhắn qua Bot Telegram:
`+/-số tiền, tag, nội dung(tùy chọn), thời gian(tùy chọn)`

> **Quy tắc khi không ghi tag:**
> - Nếu dấu **`-`** (chi tiêu): Tự động trừ vào **Quỹ Tiêu dùng**.
> - Nếu dấu **`+`** (thu nhập): Tự động cộng vào **Quỹ Tiết kiệm**.

#### Ví dụ:
- Chi tiêu dùng: `-50k, tiêu dùng, ăn trưa, 12/00`
- Chi tiêu tắt không cần tag (tự vào Tiêu dùng): `-45k, cơm trưa`
- Chi phát sinh: `-30k, phát sinh, gửi xe`
- Trả bớt nợ: `+200k, trả nợ, trả nợ bạn`
- Thu nhập / Tiết kiệm: `+100k, tiết kiệm, tiền mừng`
- Thu nhập tắt không cần tag (tự vào Tiết kiệm): `+500k, làm thêm, 15/30/02/10`
- Nhập siêu nhanh chỉ có tiền: `-25k` hoặc `+200k`

---

### 3. Các lệnh tra cứu nhanh trên Bot Telegram:
- `?`: Xem bảng hướng dẫn đầy đủ về cú pháp giao tiếp với bot.
- `/finance` (hoặc `/tien`, `/vi`): Xem tình hình tài chính hiện tại, số dư 4 quỹ & tiến độ chu kỳ.
- `/web`: Lấy mã PIN 6 số để đăng nhập vào Web Dashboard.
- `/start` hoặc `/help`: Khởi động và xem thông tin giới thiệu.

---

### 4. Giao diện Web:
- Chuyển đổi giữa 2 tab: `DEADLINE` và `TÀI CHÍNH 4 QUỸ`.
- **Chỉnh sửa số dư:** Cho phép bấm nút `[Sửa số dư]` ở bất kỳ quỹ nào để cập nhật số dư mong muốn trực tiếp (nhập dạng `500k`, `-700k`, `1000000`, v.v.).
- Hiển thị trực quan 4 quỹ dạng chữ phẳng (không emoji/icon), hạn mức tuần và tháng.
- Lịch sử giao dịch & vết tự động kết chuyển số dư.

