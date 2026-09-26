let currentStatus = 'active';

async function loadDeadlines(status = currentStatus) {
  currentStatus = status;
  
  // Cập nhật tab UI
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  document.querySelectorAll('.tab-btn')[status === 'active' ? 0 : 1].classList.add('active');

  const res = await fetch(`/api/deadlines?status=${status}`);
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
    body: JSON.stringify({ status: 'completed' })
  });
  loadDeadlines();
}

async function markActive(id) {
  await fetch(`/api/deadlines/${id}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'active' })
  });
  loadDeadlines();
}

async function deleteItem(id) {
  if (confirm('Bạn có chắc muốn xóa deadline này?')) {
    await fetch(`/api/deadlines/${id}`, { method: 'DELETE' });
    loadDeadlines();
  }
}

// Khởi tạo
loadDeadlines('active');
