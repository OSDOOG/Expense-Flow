const db = require('../config/db');
const { logAudit } = require('../utils/logger');

const checkPermission = (permissionCode) => {
  return async (req, res, next) => {
    try {
      if (!req.user || !req.user.role_id) {
        return res.status(401).json({ success: false, error: 'Unauthorized: ไม่พบข้อมูลสิทธิ์' });
      }

      const codes = Array.isArray(permissionCode) ? permissionCode : [permissionCode];

      const query = `
        SELECT p.code
        FROM role_permissions rp
        JOIN permissions p ON rp.permission_id = p.id
        WHERE rp.role_id = $1 AND p.code = ANY($2::text[])
      `;
      const result = await db.query(query, [req.user.role_id, codes]);

      if (result.rows.length === 0) {
        const requiredCodeStr = codes.join(' หรือ ');
        await logAudit({
          userId: req.user.id,
          username: req.user.username,
          action: 'ACCESS_DENIED',
          resource: 'PERMISSION',
          resourceId: codes[0],
          details: `ผู้ใช้ไม่มีสิทธิ์ [${requiredCodeStr}] สำหรับการกระทำนี้`,
          ipAddress: req.ip || req.connection.remoteAddress,
          userAgent: req.get('user-agent'),
          status: 'FAILED'
        });

        const errorMsg = `ปฏิเสธการเข้าถึง: บทบาทของคุณไม่มีสิทธิ์ดำเนินการ [${requiredCodeStr}]`;

        if (req.accepts('html') && !req.xhr && !req.path.startsWith('/api/')) {
          return res.status(403).send(`<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>403 ปฏิเสธการเข้าถึง (Access Denied)</title>
  <link rel="stylesheet" href="/css/style.css">
  <style>
    body {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 1.5rem;
      background: radial-gradient(circle at 50% 20%, rgba(239, 68, 68, 0.12), transparent 45%), #0b0f19;
      font-family: 'Plus Jakarta Sans', 'Sarabun', sans-serif;
      color: #f8fafc;
    }
    .error-card {
      background: rgba(20, 29, 48, 0.85);
      border: 1px solid rgba(239, 68, 68, 0.3);
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(20px);
      border-radius: 20px;
      max-width: 500px;
      width: 100%;
      padding: 2.5rem 2rem;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="error-card">
    <div style="font-size: 3rem; margin-bottom: 1rem;">🛡️</div>
    <div style="color: #fca5a5; font-size: 0.8rem; font-weight: 700; margin-bottom: 0.5rem;">HTTP 403 • FORBIDDEN</div>
    <h1 style="font-size: 1.4rem; margin-bottom: 0.75rem;">ไม่มีสิทธิ์เข้าถึงส่วนนี้</h1>
    <p style="color: #94a3b8; font-size: 0.9rem; margin-bottom: 1.5rem;">${errorMsg}</p>
    <a href="/app" class="btn btn-primary">← กลับสู่หน้าหลัก</a>
  </div>
</body>
</html>`);
        }

        return res.status(403).json({
          success: false,
          error: errorMsg
        });
      }

      next();
    } catch (err) {
      console.error('ACL Check Error:', err);
      res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการตรวจสอบสิทธิ์' });
    }
  };
};

module.exports = {
  checkPermission
};
