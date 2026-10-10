(function() {
  const savedTheme = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
})();

function getTheme() {
  return document.documentElement.getAttribute('data-theme') || 'dark';
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  updateThemeButtons();
}

function toggleTheme() {
  const current = getTheme();
  const next = current === 'dark' ? 'light' : 'dark';
  setTheme(next);
}

function updateThemeButtons() {
  const theme = getTheme();
  const icon = theme === 'dark' ? '🌙' : '☀️';
  const title = theme === 'dark' ? 'เปลี่ยนเป็นโหมดสว่าง (Light Mode)' : 'เปลี่ยนเป็นโหมดมืด (Dark Mode)';
  document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
    btn.innerHTML = icon;
    btn.setAttribute('title', title);
    btn.setAttribute('aria-label', title);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  updateThemeButtons();
  initCustomFormValidation();
});

function initCustomFormValidation() {
  let activeTooltip = null;

  function removeTooltip() {
    if (activeTooltip) {
      activeTooltip.remove();
      activeTooltip = null;
    }
  }

  document.addEventListener('invalid', (e) => {
    const input = e.target;
    if (!input || !input.validity) return;

    e.preventDefault(); // ปิด default tooltip ของ browser

    removeTooltip();

    input.classList.remove('input-invalid-shake');
    void input.offsetWidth;
    input.classList.add('input-invalid-shake');

    let msg = 'โปรดกรอกข้อมูลในช่องนี้';
    if (input.validity.valueMissing) {
      msg = 'โปรดกรอกข้อมูลในช่องนี้';
    } else if (input.validity.typeMismatch) {
      msg = 'รูปแบบข้อมูลไม่ถูกต้อง';
    } else if (input.validity.tooShort) {
      msg = `กรุณากรอกอย่างน้อย ${input.minLength} ตัวอักษร`;
    } else if (input.validity.rangeUnderflow) {
      msg = `ค่าต้องไม่น้อยกว่า ${input.min}`;
    } else if (input.validationMessage) {
      msg = input.validationMessage;
    }

    const tooltip = document.createElement('div');
    tooltip.className = 'custom-val-tooltip';
    tooltip.innerHTML = `
      <span class="custom-val-icon">!</span>
      <span class="custom-val-text">${msg}</span>
    `;

    document.body.appendChild(tooltip);
    activeTooltip = tooltip;

    const rect = input.getBoundingClientRect();
    const top = rect.bottom + window.scrollY + 8;
    const left = Math.max(10, rect.left + window.scrollX);

    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;

    input.focus();

    const cleanupEvents = () => {
      input.classList.remove('input-invalid-shake');
      removeTooltip();
      input.removeEventListener('input', cleanupEvents);
      input.removeEventListener('change', cleanupEvents);
    };

    input.addEventListener('input', cleanupEvents);
    input.addEventListener('change', cleanupEvents);

    setTimeout(() => {
      removeTooltip();
    }, 4500);
  }, true);

  document.addEventListener('click', (e) => {
    if (activeTooltip && !activeTooltip.contains(e.target)) {
      removeTooltip();
    }
  });

  window.addEventListener('resize', removeTooltip);
}

(function() {
  if (typeof console !== 'undefined' && console.clear) {
    try {
      console.clear();
      console.log(
        '%c⚠️ คำเตือนความปลอดภัย (Security Warning)',
        'color: #ef4444; font-size: 1.5rem; font-weight: 800; background: rgba(239, 68, 68, 0.1); padding: 4px 8px; border-radius: 4px;'
      );
      console.log(
        '%cพื้นที่นี้สำหรับนักพัฒนาเท่านั้น ห้ามคัดลอกหรือวางโค้ดจากผู้อื่นที่นี่เพื่อป้องกันการถูกขโมยข้อมูลหรือบัญชีผู้ใช้',
        'color: #94a3b8; font-size: 0.95rem; font-weight: 500;'
      );
    } catch (e) {}
  }
})();

const api = {
  get: async (url) => {
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'เกิดข้อผิดพลาดในการโหลดข้อมูล');
    return data;
  },
  post: async (url, body) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'เกิดข้อผิดพลาดในการส่งข้อมูล');
    return data;
  },
  put: async (url, body) => {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'เกิดข้อผิดพลาดในการอัปเดตข้อมูล');
    return data;
  },
  delete: async (url) => {
    const res = await fetch(url, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'เกิดข้อผิดพลาดในการลบข้อมูล');
    return data;
  },
  upload: async (url, formData) => {
    const res = await fetch(url, {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'เกิดข้อผิดพลาดในการอัปโหลดไฟล์');
    return data;
  }
};

function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerText = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 4000);
}

function customConfirm({
  title = 'ยืนยันการทำรายการ',
  message = 'คุณแน่ใจหรือไม่ว่าต้องการดำเนินการต่อ?',
  icon = '⚠️',
  confirmText = 'ยืนยัน',
  cancelText = 'ยกเลิก',
  confirmType = 'danger'
} = {}) {
  return new Promise((resolve) => {
    const existing = document.getElementById('custom-confirm-modal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'custom-confirm-modal';
    overlay.className = 'custom-confirm-overlay active';

    let btnClass = 'btn-danger';
    if (confirmType === 'primary') btnClass = 'btn-primary';
    if (confirmType === 'warning') btnClass = 'btn-warning';

    overlay.innerHTML = `
      <div class="custom-confirm-card">
        <div class="custom-confirm-header">
          <div class="custom-confirm-icon ${confirmType}">${icon}</div>
          <div class="custom-confirm-title">${title}</div>
        </div>
        <div class="custom-confirm-body">${message}</div>
        <div class="custom-confirm-actions">
          <button type="button" class="btn btn-secondary custom-confirm-cancel">${cancelText}</button>
          <button type="button" class="btn ${btnClass} custom-confirm-confirm">${confirmText}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const cleanup = (result) => {
      overlay.classList.remove('active');
      setTimeout(() => overlay.remove(), 200);
      resolve(result);
    };

    overlay.querySelector('.custom-confirm-cancel').onclick = () => cleanup(false);
    overlay.querySelector('.custom-confirm-confirm').onclick = () => cleanup(true);

    overlay.onclick = (e) => {
      if (e.target === overlay) cleanup(false);
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        window.removeEventListener('keydown', handleKeyDown);
        cleanup(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown, { once: true });
  });
}

function formatMoney(amount) {
  return Number(amount).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ฿';
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleString('th-TH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

async function initUserNavbar() {
  try {
    const data = await api.get('/api/auth/me');
    const user = data.user;
    if (!user) {
      window.location.href = '/';
      return;
    }

    const badge = document.getElementById('user-profile-badge');
    if (badge) {
      const theme = getTheme();
      const icon = theme === 'dark' ? '🌙' : '☀️';
      const title = theme === 'dark' ? 'เปลี่ยนเป็นโหมดสว่าง (Light Mode)' : 'เปลี่ยนเป็นโหมดมืด (Dark Mode)';
      badge.innerHTML = `
        <button type="button" class="theme-toggle-btn" onclick="toggleTheme()" title="${title}" aria-label="${title}">
          ${icon}
        </button>
        <div class="user-badge-info">
          <span class="user-badge-name">${user.full_name}</span>
          <span class="role-pill role-${user.role_name}">${user.role_name}</span>
        </div>
        <button class="btn btn-secondary btn-sm user-logout-btn" onclick="logout()">
          <span>ออกจากระบบ</span>
        </button>
      `;
    }

    const adminLink = document.getElementById('admin-nav-item');
    if (adminLink) {
      const isAdminRole = user.role_name && user.role_name.toLowerCase() === 'admin';
      const adminPerms = ['acl.manage', 'user.read', 'log.read', 'role.manage', 'permission.manage'];
      const hasAdminPerm = user.permissions && user.permissions.some(p => adminPerms.includes(p));

      if (isAdminRole || hasAdminPerm) {
        adminLink.style.display = 'inline-block';
      } else {
        adminLink.style.display = 'none';
      }
    }

    const isAdminRole = user.role_name && user.role_name.toLowerCase() === 'admin';
    const aclTab = document.querySelector('a[href="/admin/acl-matrix"], a[href="/admin"]');
    const usersTab = document.querySelector('a[href="/admin/users"]');
    const logsTab = document.querySelector('a[href="/admin/logs"]');

    if (aclTab && !isAdminRole) {
      const canManageAcl = user.permissions && user.permissions.includes('acl.manage');
      aclTab.style.display = canManageAcl ? 'inline-block' : 'none';
    }
    if (usersTab && !isAdminRole) {
      const canReadUsers = user.permissions && user.permissions.includes('user.read');
      usersTab.style.display = canReadUsers ? 'inline-block' : 'none';
    }
    if (logsTab && !isAdminRole) {
      const canReadLogs = user.permissions && user.permissions.includes('log.read');
      logsTab.style.display = canReadLogs ? 'inline-block' : 'none';
    }

    return user;
  } catch (err) {
    window.location.href = '/';
  }
}

async function logout() {
  try {
    await api.post('/api/auth/logout', {});
    showToast('ออกจากระบบแล้ว', 'success');
    setTimeout(() => { window.location.href = '/'; }, 500);
  } catch (err) {
    showToast(err.message, 'error');
  }
}
