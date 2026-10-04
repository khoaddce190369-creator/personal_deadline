let currentDeadlineStatus = 'active';
let currentFinanceFilter = 'all';
let currentTransType = 'expense';
let currentSection = localStorage.getItem('activeSection') || 'deadline';
let myChatId = localStorage.getItem('chatId');
let overviewData = null;

// Khởi động khi tải trang
if (myChatId) {
  showAppView();
}

function showAppView() {
  document.getElementById('login-container').style.display = 'none';
  document.getElementById('app-container').style.display = 'block';
  switchSection(currentSection);
}

// Chuyển đổi giữa [DEADLINE] và [QUẢN LÝ TÀI CHÍNH]
function switchSection(section) {
  currentSection = section;
  localStorage.setItem('activeSection', section);

  const deadlineBtn = document.getElementById('nav-deadline-btn');
  const financeBtn = document.getElementById('nav-finance-btn');
  const deadlineSec = document.getElementById('section-deadline');
  const financeSec = document.getElementById('section-finance');

  if (section === 'deadline') {
    deadlineBtn.classList.add('active');
    financeBtn.classList.remove('active');
    deadlineSec.style.display = 'block';
    financeSec.style.display = 'none';
    loadDeadlines();
  } else {
    deadlineBtn.classList.remove('active');
    financeBtn.classList.add('active');
    deadlineSec.style.display = 'none';
    financeSec.style.display = 'block';
    loadFinanceOverview();
    loadTransactions(currentFinanceFilter);
  }
}

// Đăng nhập
async function login() {
  const chatId = document.getElementById('chat-id-input').value.trim();
  const pin = document.getElementById('pin-input').value.trim();
  const errorEl = document.getElementById('login-error');
  
  if (!chatId || !pin) return;

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, pin })
    });
    
    const data = await res.json();
    if (data.success) {
      localStorage.setItem('chatId', chatId);
      myChatId = chatId;
      errorEl.style.display = 'none';
      showAppView();
    } else {
      errorEl.style.display = 'block';
    }
  } catch (err) {
    errorEl.textContent = 'Lỗi kết nối máy chủ';
    errorEl.style.display = 'block';
  }
}

// Đăng xuất
function logout() {
  localStorage.removeItem('chatId');
  myChatId = null;
  document.getElementById('login-container').style.display = 'block';
  document.getElementById('app-container').style.display = 'none';
  document.getElementById('chat-id-input').value = '';
  document.getElementById('pin-input').value = '';
}

// ================= PHẦN QUẢN LÝ DEADLINE =================

async function loadDeadlines(status = currentDeadlineStatus) {
  if (!myChatId) return;
  currentDeadlineStatus = status;
  
  const tabs = document.querySelectorAll('#section-deadline .tab-btn');
  tabs.forEach(btn => btn.classList.remove('active'));
  if (tabs.length >= 2) {
    tabs[status === 'active' ? 0 : 1].classList.add('active');
  }

  try {
    const res = await fetch(`/api/deadlines?status=${status}&chatId=${myChatId}`);
    const data = await res.json();

    const listEl = document.getElementById('deadline-list');
    listEl.innerHTML = '';

    if (!Array.isArray(data) || data.length === 0) {
      listEl.innerHTML = `<p style="text-align:center; color: var(--text-muted); padding: 20px;">Không có deadline nào.</p>`;
      return;
    }

    data.forEach(item => {
      const formattedTime = dayjs(item.deadline_time).format('HH:mm DD/MM/YYYY');
      const remindTime = dayjs(item.deadline_time - item.remind_before_minutes * 60000).format('HH:mm DD/MM/YYYY');
      
      const card = document.createElement('div');
      card.className = 'deadline-card';
      if (status === 'completed') card.style.borderLeftColor = '#555';

      card.innerHTML = `
        <div class="deadline-info">
          <h3>${escapeHtml(item.title)}</h3>
          <p>Hạn chót: ${formattedTime}</p>
          <p>Nhắc lúc: ${remindTime}</p>
        </div>
        <div class="actions">
          ${status === 'active' 
            ? `<button class="btn-done" onclick="markDeadlineDone(${item.id})">Xong</button>` 
            : `<button class="btn-done" onclick="markDeadlineActive(${item.id})">Hoàn tác</button>`}
          <button class="btn-del" onclick="deleteDeadline(${item.id})">Xóa</button>
        </div>
      `;
      listEl.appendChild(card);
    });
  } catch (err) {
    console.error('Lỗi khi tải deadlines:', err);
  }
}

async function markDeadlineDone(id) {
  await fetch(`/api/deadlines/${id}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'completed', chatId: myChatId })
  });
  loadDeadlines();
}

async function markDeadlineActive(id) {
  await fetch(`/api/deadlines/${id}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'active', chatId: myChatId })
  });
  loadDeadlines();
}

async function deleteDeadline(id) {
  if (confirm('Bạn có chắc muốn xóa deadline này?')) {
    await fetch(`/api/deadlines/${id}?chatId=${myChatId}`, { method: 'DELETE' });
    loadDeadlines();
  }
}

// ================= PHẦN QUẢN LÝ TÀI CHÍNH =================

// Format số tiền VNĐ (hỗ trợ cả số âm)
function formatMoney(amount) {
  const num = Number(amount) || 0;
  const sign = num < 0 ? '-' : '';
  return sign + Math.abs(num).toLocaleString('vi-VN') + ' đ';
}

// Tải dữ liệu tổng quan tài chính
async function loadFinanceOverview() {
  if (!myChatId) return;

  try {
    const res = await fetch(`/api/finance/overview?chatId=${myChatId}`);
    const data = await res.json();
    overviewData = data;

    // 1. Cập nhật Tổng tiền tất cả các quỹ
    document.getElementById('total-balance-display').textContent = formatMoney(data.totalBalance);

    // 2. Cập nhật Thống kê Tuần
    document.getElementById('week-label-display').textContent = data.weekInfo.label;
    document.getElementById('weekly-budget-display').textContent = formatMoney(data.weeklyBudget);
    document.getElementById('weekly-spent-display').textContent = formatMoney(data.spentThisWeek);

    const remainingEl = document.getElementById('weekly-remaining-display');
    const progressBar = document.getElementById('budget-progress-bar');
    const progressText = document.getElementById('budget-progress-text');

    remainingEl.textContent = formatMoney(data.remainingWeek);
    if (data.remainingWeek < 0) {
      remainingEl.style.color = 'var(--danger)';
    } else {
      remainingEl.style.color = 'var(--accent)';
    }

    const percentage = Math.min(100, Math.round((data.spentThisWeek / data.weeklyBudget) * 100));
    progressBar.style.width = `${percentage}%`;
    progressBar.className = 'progress-bar-fill';

    if (percentage >= 100 || data.remainingWeek < 0) {
      progressBar.classList.add('danger');
      progressText.innerHTML = `<strong style="color: var(--danger)">Vượt hạn mức (${percentage}%)</strong>`;
    } else if (percentage >= 75) {
      progressBar.classList.add('warning');
      progressText.innerHTML = `<span style="color: var(--warning)">Đã chi ${percentage}% (${formatMoney(data.spentThisWeek)} / ${formatMoney(data.weeklyBudget)})</span>`;
    } else {
      progressText.textContent = `Đã chi ${percentage}% (${formatMoney(data.spentThisWeek)} / ${formatMoney(data.weeklyBudget)})`;
    }

    // 3. Render danh sách 4 Quỹ chuẩn (kèm chức năng chỉnh sửa số tiền)
    renderFunds(data.funds);

  } catch (err) {
    console.error('Lỗi khi tải tổng quan tài chính:', err);
  }
}

// Chỉnh sửa hạn mức chi tiêu tuần trực tiếp qua Web
async function handleEditWeeklyBudget() {
  const currentBudget = overviewData ? overviewData.weeklyBudget : 500000;
  const input = prompt('Nhập hạn mức tuần mới (VD: 500k, 700k):', currentBudget);
  if (input === null || input.trim() === '') return;

  try {
    const res = await fetch('/api/finance/weekly-budget', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: myChatId, amount: input.trim() })
    });
    const result = await res.json();
    if (result.success) {
      loadFinanceOverview();
    } else {
      alert('Lỗi: ' + (result.error || 'Không thể cập nhật hạn mức'));
    }
  } catch (err) {
    alert('Lỗi kết nối khi cập nhật hạn mức');
  }
}

// Render thẻ các Quỹ cố định (hoàn toàn không có icon, không ghi chú thừa)
function renderFunds(funds) {
  const fundsList = document.getElementById('funds-list');
  fundsList.innerHTML = '';

  const fundMeta = {
    'Tiêu dùng': '300k/tuần',
    'Phát sinh': '200k/tuần',
    'Trả nợ': '-700k/tháng',
    'Tiết kiệm': 'Tích lũy'
  };

  funds.forEach(fund => {
    const allowance = fundMeta[fund.name] || '';
    const card = document.createElement('div');
    card.className = 'fund-card';
    const isNegative = Number(fund.balance) < 0;

    card.innerHTML = `
      <div class="fund-name">
        <span>${escapeHtml(fund.name)}</span>
        <span class="fund-tag-pill">${allowance}</span>
      </div>
      <div class="fund-balance ${isNegative ? 'negative' : ''}">
        ${formatMoney(fund.balance)}
      </div>
      <div style="margin-top: 10px; border-top: 1px dashed var(--border-color); padding-top: 8px; text-align: right;">
        <button class="btn-small" onclick="handleEditFundBalance(${fund.id}, '${escapeHtml(fund.name)}', ${fund.balance})">Sửa số tiền</button>
      </div>
    `;
    fundsList.appendChild(card);
  });
}

// Chỉnh sửa số tiền của bất kỳ quỹ nào trực tiếp qua Web
async function handleEditFundBalance(fundId, fundName, currentBalance) {
  const input = prompt(`Nhập số tiền mới cho quỹ "${fundName}" (VD: 500k, -700k):`, currentBalance);
  if (input === null || input.trim() === '') return;

  try {
    const res = await fetch(`/api/finance/funds/${fundId}/balance`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: myChatId, balance: input.trim() })
    });
    const result = await res.json();
    if (result.success) {
      loadFinanceOverview();
      loadTransactions(currentFinanceFilter);
    } else {
      alert('Lỗi: ' + (result.error || 'Không thể cập nhật số tiền'));
    }
  } catch (err) {
    alert('Lỗi kết nối khi cập nhật số tiền');
  }
}

// Chỉnh sửa tổng số tiền trực tiếp qua Web
async function handleEditTotalBalance() {
  const currentTotalText = document.getElementById('total-balance-display').textContent.trim();
  const input = prompt(`Nhập tổng số tiền mới (VD: 5tr, 500k):`, currentTotalText.replace(/[^\d-]/g, ''));
  if (input === null || input.trim() === '') return;

  try {
    const res = await fetch('/api/finance/total-money', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: myChatId, amount: input.trim() })
    });
    const result = await res.json();
    if (result.success) {
      loadFinanceOverview();
      loadTransactions(currentFinanceFilter);
    } else {
      alert('Lỗi: ' + (result.error || 'Không thể cập nhật tổng số tiền'));
    }
  } catch (err) {
    alert('Lỗi kết nối khi cập nhật tổng số tiền');
  }
}

// Chọn loại giao dịch (Chi tiêu hay Thu nhập)
function selectTransType(type) {
  currentTransType = type;
  const expenseBtn = document.getElementById('type-expense-btn');
  const incomeBtn = document.getElementById('type-income-btn');
  const fundSelect = document.getElementById('trans-fund-select');

  if (type === 'expense') {
    expenseBtn.classList.add('active');
    incomeBtn.classList.remove('active');
    if (fundSelect.value === 'Tiết kiệm') {
      fundSelect.value = 'Tiêu dùng';
    }
  } else {
    expenseBtn.classList.remove('active');
    incomeBtn.classList.add('active');
    if (fundSelect.value === 'Tiêu dùng' || fundSelect.value === 'Phát sinh') {
      fundSelect.value = 'Tiết kiệm';
    }
  }
}

// Thêm giao dịch mới từ Web
async function handleAddTransaction() {
  const amountStr = document.getElementById('trans-amount-input').value.trim();
  const fundName = document.getElementById('trans-fund-select').value;
  const description = document.getElementById('trans-desc-input').value.trim();
  const timeStr = document.getElementById('trans-time-input').value.trim();

  if (!amountStr) {
    alert('Vui lòng nhập số tiền (VD: 50k hoặc 50000)!');
    return;
  }

  const typeLabel = currentTransType === 'income' ? 'Thu nhập (+)' : 'Chi tiêu (-)';
  const descLabel = description || (currentTransType === 'income' ? 'Thu nhập ' + fundName : 'Chi tiêu ' + fundName);
  const nowDisplay = dayjs().format('HH:mm DD/MM/YYYY');
  const timeDisplay = timeStr ? timeStr : `${nowDisplay} (Mặc định thời điểm nhập)`;

  const confirmMsg = `XÁC NHẬN GIAO DỊCH:\n`
                   + `• ${typeLabel}: ${amountStr}\n`
                   + `• Quỹ: ${fundName}\n`
                   + `• Nội dung: ${descLabel}\n`
                   + `• Thời gian: ${timeDisplay}\n\n`
                   + `Lưu giao dịch này?`;

  if (!confirm(confirmMsg)) {
    return;
  }

  try {
    const res = await fetch('/api/finance/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatId: myChatId,
        type: currentTransType,
        amount: amountStr,
        fundName,
        description: descLabel,
        timeStr: timeStr || undefined
      })
    });

    const result = await res.json();
    if (result.success) {
      document.getElementById('trans-amount-input').value = '';
      document.getElementById('trans-desc-input').value = '';
      document.getElementById('trans-time-input').value = '';
      loadFinanceOverview();
      loadTransactions(currentFinanceFilter);
      alert(
        `Đã lưu giao dịch:\n` +
        `• ${result.type === 'income' ? 'Thu' : 'Chi'}: ${formatMoney(result.amount)}\n` +
        `• Quỹ: ${result.fund_name} (${formatMoney(result.fund_balance)})\n` +
        `• Tổng tiền: ${formatMoney(result.total_balance)}`
      );
    } else {
      alert('Lỗi: ' + (result.error || 'Không thể thêm giao dịch'));
    }
  } catch (err) {
    alert('Lỗi khi thêm giao dịch: ' + err.message);
  }
}

// Tải lịch sử giao dịch (hoàn toàn không có icon)
async function loadTransactions(filter = currentFinanceFilter) {
  if (!myChatId) return;
  currentFinanceFilter = filter;

  // Cập nhật tab active
  const filterTabs = document.querySelectorAll('.filter-tabs .tab-btn');
  const filterMap = { 'all': 0, 'expense': 1, 'income': 2, 'week': 3 };
  filterTabs.forEach(b => b.classList.remove('active'));
  if (filterTabs[filterMap[filter]]) {
    filterTabs[filterMap[filter]].classList.add('active');
  }

  let url = `/api/finance/transactions?chatId=${myChatId}&limit=50`;
  if (filter === 'expense' || filter === 'income') {
    url += `&type=${filter}`;
  } else if (filter === 'week') {
    url += `&weekOnly=true`;
  }

  try {
    const res = await fetch(url);
    const data = await res.json();
    const listEl = document.getElementById('transactions-list');
    listEl.innerHTML = '';

    if (!Array.isArray(data) || data.length === 0) {
      listEl.innerHTML = `<p style="text-align: center; color: var(--text-muted); padding: 15px;">Chưa có giao dịch nào.</p>`;
      return;
    }

    data.forEach(item => {
      const isExpense = item.type === 'expense';
      const timeStr = dayjs(item.created_at).format('HH:mm DD/MM');
      const itemEl = document.createElement('div');
      itemEl.className = `trans-item ${item.type}`;

      itemEl.innerHTML = `
        <div class="trans-left">
          <div class="trans-desc">
            ${escapeHtml(item.description)}
          </div>
          <div class="trans-meta">
            <span>[${escapeHtml(item.fund_name)}]</span>
            <span>${timeStr}</span>
          </div>
        </div>
        <div class="trans-right">
          <div class="trans-amount ${item.type}">
            ${isExpense ? '-' : '+'}${formatMoney(item.amount)}
          </div>
          <button class="btn-del" style="padding: 3px 6px; font-size: 11px;" onclick="handleDeleteTransaction(${item.id})">Xóa</button>
        </div>
      `;
      listEl.appendChild(itemEl);
    });
  } catch (err) {
    console.error('Lỗi khi tải lịch sử giao dịch:', err);
  }
}

// Xóa giao dịch (hoàn lại số dư quỹ tương ứng)
async function handleDeleteTransaction(id) {
  if (confirm('Xóa giao dịch này? Số tiền sẽ được hoàn lại vào quỹ.')) {
    try {
      const res = await fetch(`/api/finance/transactions/${id}?chatId=${myChatId}`, { method: 'DELETE' });
      const result = await res.json();
      if (result.success) {
        loadFinanceOverview();
        loadTransactions(currentFinanceFilter);
      }
    } catch (err) {
      alert('Lỗi khi xóa giao dịch');
    }
  }
}

// Tránh XSS
function escapeHtml(text) {
  if (!text) return '';
  return text.toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
