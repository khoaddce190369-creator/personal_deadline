let currentDeadlineStatus = 'active';
let currentFinanceFilter = 'all';
let currentTransType = 'expense';
let currentSection = localStorage.getItem('activeSection') || 'deadline';
let myChatId = localStorage.getItem('chatId');

// Khởi động khi tải trang
if (myChatId) {
  showAppView();
}

function showAppView() {
  document.getElementById('login-container').style.display = 'none';
  document.getElementById('app-container').style.display = 'block';
  switchSection(currentSection);
}

// Chuyển đổi giữa [DEADLINE] và [QUẢN LÝ TIỀN]
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
            ? `<button class="btn-done" onclick="markDeadlineDone(${item.id})">✔ Xong</button>` 
            : `<button class="btn-done" onclick="markDeadlineActive(${item.id})">↩ Hoàn tác</button>`}
          <button class="btn-del" onclick="deleteDeadline(${item.id})">✖ Xóa</button>
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

// ================= PHẦN QUẢN LÝ TIỀN BẠC (FINANCE) =================

// Format số tiền VNĐ
function formatMoney(amount) {
  const num = Number(amount) || 0;
  return num.toLocaleString('vi-VN') + ' đ';
}

// Tải dữ liệu tổng quan tài chính
async function loadFinanceOverview() {
  if (!myChatId) return;

  try {
    const res = await fetch(`/api/finance/overview?chatId=${myChatId}`);
    const data = await res.json();

    // 1. Cập nhật Tổng tiền tất cả các quỹ
    document.getElementById('total-balance-display').textContent = formatMoney(data.totalBalance);
    document.getElementById('funds-count-display').textContent = `${data.funds.length} quỹ đang hoạt động`;

    // 2. Cập nhật Thống kê Tuần
    document.getElementById('week-label-display').textContent = data.weekInfo.label;
    document.getElementById('weekly-budget-display').textContent = formatMoney(data.weeklyBudget);
    document.getElementById('weekly-spent-display').textContent = formatMoney(data.spentThisWeek);

    const remainingEl = document.getElementById('weekly-remaining-display');
    const progressBar = document.getElementById('budget-progress-bar');
    const progressText = document.getElementById('budget-progress-text');

    if (data.weeklyBudget > 0) {
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
        progressText.innerHTML = `⚠️ <strong style="color: var(--danger)">ĐÃ VƯỢT HẠN MỨC TUẦN</strong> (${percentage}%)`;
      } else if (percentage >= 75) {
        progressBar.classList.add('warning');
        progressText.innerHTML = `<span style="color: var(--warning)">Đã dùng ${percentage}% hạn mức tuần</span>`;
      } else {
        progressText.textContent = `Đã dùng ${percentage}% hạn mức tuần`;
      }
    } else {
      remainingEl.textContent = '--';
      remainingEl.style.color = 'var(--text-muted)';
      progressBar.style.width = '0%';
      progressText.textContent = 'Chưa đặt hạn mức tuần. Bấm "✏️ Đặt hạn mức" để quản lý.';
    }

    // 3. Render danh sách các Quỹ
    renderFunds(data.funds);

  } catch (err) {
    console.error('Lỗi khi tải tổng quan tài chính:', err);
  }
}

// Render thẻ các quỹ
function renderFunds(funds) {
  const fundsList = document.getElementById('funds-list');
  const fundSelect = document.getElementById('trans-fund-select');
  fundsList.innerHTML = '';
  fundSelect.innerHTML = '';

  if (!funds || funds.length === 0) {
    fundsList.innerHTML = `<p style="grid-column: 1/-1; color: var(--text-muted); text-align: center;">Chưa có quỹ nào.</p>`;
    return;
  }

  funds.forEach(fund => {
    // Thêm option vào dropdown chọn quỹ khi ghi nhận giao dịch
    const opt = document.createElement('option');
    opt.value = fund.name;
    opt.textContent = `${fund.name} (${formatMoney(fund.balance)})`;
    fundSelect.appendChild(opt);

    // Thẻ card hiển thị quỹ
    const card = document.createElement('div');
    card.className = 'fund-card';
    const isNegative = Number(fund.balance) < 0;

    card.innerHTML = `
      <div class="fund-name">
        <span>${escapeHtml(fund.name)}</span>
        ${funds.length > 1 ? `<button class="btn-fund-del" onclick="handleDeleteFund(${fund.id}, '${escapeHtml(fund.name)}')" title="Xóa quỹ">✖</button>` : ''}
      </div>
      <div class="fund-balance ${isNegative ? 'negative' : ''}">
        ${formatMoney(fund.balance)}
      </div>
    `;
    fundsList.appendChild(card);
  });
}

// Mở popup đặt hạn mức tuần
async function openBudgetModal() {
  const currentBudget = document.getElementById('weekly-budget-display').textContent;
  const input = prompt('Nhập hạn mức chi tiêu cho 1 tuần (VD: 1500000 hoặc 1.5tr):', currentBudget.replace(/[^\d]/g, ''));
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
    alert('Lỗi kết nối khi đặt hạn mức tuần');
  }
}

// Ẩn/hiện form tạo quỹ
function toggleFundForm() {
  const form = document.getElementById('new-fund-form');
  const isHidden = form.style.display === 'none';
  form.style.display = isHidden ? 'flex' : 'none';
  if (isHidden) {
    document.getElementById('fund-name-input').focus();
  }
}

// Tạo quỹ mới
async function handleCreateFund() {
  const name = document.getElementById('fund-name-input').value.trim();
  const balance = document.getElementById('fund-init-balance-input').value.trim();

  if (!name) {
    alert('Vui lòng nhập tên quỹ!');
    return;
  }

  try {
    const res = await fetch('/api/finance/funds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: myChatId, name, initialBalance: balance })
    });
    const result = await res.json();
    if (result.success) {
      document.getElementById('fund-name-input').value = '';
      document.getElementById('fund-init-balance-input').value = '';
      toggleFundForm();
      loadFinanceOverview();
    } else {
      alert('Lỗi: ' + (result.error || 'Không thể tạo quỹ'));
    }
  } catch (err) {
    alert('Lỗi khi tạo quỹ');
  }
}

// Xóa quỹ
async function handleDeleteFund(fundId, fundName) {
  if (confirm(`Bạn có chắc muốn xóa quỹ "${fundName}"? (Các giao dịch thuộc quỹ này vẫn được bảo lưu)`)) {
    try {
      const res = await fetch(`/api/finance/funds/${fundId}?chatId=${myChatId}`, { method: 'DELETE' });
      const result = await res.json();
      if (result.success) {
        loadFinanceOverview();
      }
    } catch (err) {
      alert('Lỗi khi xóa quỹ');
    }
  }
}

// Chọn loại giao dịch (Chi tiêu hay Thu nhập)
function selectTransType(type) {
  currentTransType = type;
  const expenseBtn = document.getElementById('type-expense-btn');
  const incomeBtn = document.getElementById('type-income-btn');

  if (type === 'expense') {
    expenseBtn.classList.add('active');
    incomeBtn.classList.remove('active');
  } else {
    expenseBtn.classList.remove('active');
    incomeBtn.classList.add('active');
  }
}

// Thêm giao dịch mới từ Web
async function handleAddTransaction() {
  const amountStr = document.getElementById('trans-amount-input').value.trim();
  const fundName = document.getElementById('trans-fund-select').value;
  const description = document.getElementById('trans-desc-input').value.trim();

  if (!amountStr) {
    alert('Vui lòng nhập số tiền!');
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
        description: description || (currentTransType === 'income' ? 'Thu nhập' : 'Chi tiêu')
      })
    });

    const result = await res.json();
    if (result.success) {
      document.getElementById('trans-amount-input').value = '';
      document.getElementById('trans-desc-input').value = '';
      loadFinanceOverview();
      loadTransactions(currentFinanceFilter);
    } else {
      alert('Lỗi: ' + (result.error || 'Không thể thêm giao dịch'));
    }
  } catch (err) {
    alert('Lỗi khi thêm giao dịch');
  }
}

// Tải lịch sử giao dịch
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
          <div class="trans-desc">${escapeHtml(item.description)}</div>
          <div class="trans-meta">
            <span>🏦 ${escapeHtml(item.fund_name)}</span>
            <span>🕒 ${timeStr}</span>
          </div>
        </div>
        <div class="trans-right">
          <div class="trans-amount ${item.type}">
            ${isExpense ? '-' : '+'}${formatMoney(item.amount)}
          </div>
          <button class="btn-del" style="padding: 3px 6px; font-size: 11px;" onclick="handleDeleteTransaction(${item.id})" title="Xóa giao dịch">✖</button>
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
  if (confirm('Bạn có chắc muốn xóa giao dịch này? (Số tiền sẽ được tự động hoàn lại vào quỹ)')) {
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
