const db = require('../config/db');

async function logAudit({
  userId = null,
  username = 'ANONYMOUS',
  action,
  resource,
  resourceId = null,
  details = '',
  ipAddress = null,
  userAgent = null,
  status = 'SUCCESS'
}) {
  try {
    const query = `
      INSERT INTO audit_logs (user_id, username, action, resource, resource_id, details, ip_address, user_agent, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `;
    await db.query(query, [
      userId,
      username,
      action,
      resource,
      resourceId ? String(resourceId) : null,
      details,
      ipAddress,
      userAgent ? userAgent.substring(0, 255) : null,
      status
    ]);
  } catch (err) {
    console.error('Failed to write audit log:', err.message);
  }
}

module.exports = {
  logAudit
};
