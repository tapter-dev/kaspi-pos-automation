const safe = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );
const money = (minor) =>
  new Intl.NumberFormat('ru-KZ', { style: 'currency', currency: 'KZT' }).format(Number(minor || 0) / 100);
const api = async (path, options = {}) => {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (response.status === 401) window.location.href = '/dashboard';
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
};

const load = async () => {
  try {
    const [{ data }, queues] = await Promise.all([api('/api/admin/tenants'), api('/api/admin/queues')]);
    document.getElementById('queueHealth').textContent =
      `Payments: ${queues.data.payments.waiting} waiting, ${queues.data.payments.failed} failed · ` +
      `Webhooks: ${queues.data.webhooks.waiting} waiting, ${queues.data.webhooks.failed} failed`;
    document.getElementById('tenants').innerHTML = data.length
      ? data
          .map(
            (tenant) =>
              `<tr><td><strong>${safe(tenant.name)}</strong><br><small>${safe(tenant.slug)}</small></td><td>${new Date(tenant.created_at).toLocaleDateString()}</td><td><span class="badge ${safe(tenant.status)}">${safe(tenant.status)}</span></td><td>${tenant.member_count}</td><td><span class="badge ${safe(tenant.kaspi_state)}">${safe(tenant.kaspi_state || 'none')}</span></td><td>${tenant.payment_count}</td><td>${money(tenant.payment_volume_minor)}</td><td>${tenant.failed_webhooks}</td><td><button data-tenant="${tenant.id}" data-status="${tenant.status === 'active' ? 'suspended' : 'active'}">${tenant.status === 'active' ? 'Suspend' : 'Reactivate'}</button></td></tr>`,
          )
          .join('')
      : '<tr><td colspan="9">No customer workspaces.</td></tr>';
    document.querySelectorAll('[data-tenant]').forEach((button) =>
      button.addEventListener('click', async () => {
        if (button.dataset.status === 'suspended' && !window.confirm('Suspend this customer and revoke its sessions?')) {
          return;
        }
        await api(`/api/admin/tenants/${button.dataset.tenant}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status: button.dataset.status }),
        });
        await load();
      }),
    );
  } catch (error) {
    if (error.message.includes('administrator')) {
      document.body.innerHTML =
        '<main class="auth-shell"><section class="auth-card"><h1>Access denied</h1><p>This account is not a platform administrator.</p><a href="/dashboard">Return to dashboard</a></section></main>';
      return;
    }
    document.getElementById('queueHealth').textContent = error.message;
  }
};

await load();
