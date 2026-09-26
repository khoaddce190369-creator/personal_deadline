let currentStatus = 'active';
let myChatId = localStorage.getItem('chatId');

// Kiểm tra login khi mở trang
if (myChatId) {
  document.getElementById('login-container').style.display = 'none';
  document.getElementById('app-container').style.display = 'block';
  loadDeadlines();
}

async function login() {
  const chatId = document.getElementById('chat-id-input').value;
  const pin = document.getElementById('pin-input').value;
  const errorEl = document.getElementById('login-error');
  
  if (!chatId || !pin) return;

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
    
    document.getElementById('login-container').style.display = 'none';
    document.getElementById('app-container').style.display = 'block';
    loadDeadlines();
  } else {
    errorEl.style.display = 'block';
  }
}

function logout() {
  localStorage.removeItem('chatId');
  myChatId = null;
  document.getElementById('login-container').style.display = 'block';
  document.getElementById('app-container').style.display = 'none';
  document.getElementById('chat-id-input').value = '';
  document.getElementById('pin-input').value = '';
}

async function loadDeadlines(status = currentStatus) {
  if (!myChatId) return;
  currentStatus = status;
  
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-btn')[status === 'active' ? 0 : 1].classList.add('active');

  const res = await fetch(`/api/deadlines?status=${status}&chatId=${myChatId}`);
  const data = await res.json();

  const listEl = document.getElementById('deadline-list');
  listEl.innerHTML = '';

  if (data.length === 0) {
    listEl.innerHTML = `<p style="text-align:center; color: var(--text-muted);">Không có dữ liệu.</p>`;
    return;
  }

  data.forEach(item => {
    const formattedTime = dayjs(item.deadline_time).format('HH:mm DD/MM/YYYY');
    const remindTime = dayjs(item.deadline_time - item.remind_before_minutes * 60000).format('HH:mm DD/MM/YYYY');
    
    const card = document.createElement('div');
    card.className = 'deadline-card';
    if (status === 'completed') card.style.borderLeftColor = 'gray';

    card.innerHTML = `
      <div class="deadline-info">
        <h3>${item.title}</h3>
        <p>Hạn chót: ${formattedTime}</p>
        <p>Báo lúc: ${remindTime}</p>
      </div>
      <div class="actions">
        ${status === 'active' 
          ? `<button class="btn-done" onclick="markDone(${item.id})">✔ Xong</button>` 
          : `<button class="btn-done" onclick="markActive(${item.id})">↩ Hoàn tác</button>`}
        <button class="btn-del" onclick="deleteItem(${item.id})">✖ Xóa</button>
      </div>
    `;
    listEl.appendChild(card);
  });
}

async function markDone(id) {
  await fetch(`/api/deadlines/${id}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'completed', chatId: myChatId })
  });
  loadDeadlines();
}

async function markActive(id) {
  await fetch(`/api/deadlines/${id}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'active', chatId: myChatId })
  });
  loadDeadlines();
}

async function deleteItem(id) {
  if (confirm('Bạn có chắc muốn xóa deadline này?')) {
    await fetch(`/api/deadlines/${id}?chatId=${myChatId}`, { method: 'DELETE' });
    loadDeadlines();
  }
}
