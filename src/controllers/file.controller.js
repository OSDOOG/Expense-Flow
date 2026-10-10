const path = require('path');
const fs = require('fs');
const db = require('../config/db');
const { logAudit } = require('../utils/logger');

exports.uploadFile = async (req, res) => {
  const { request_id, file_type } = req.body;
  const user = req.user;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ success: false, error: 'กรุณาเลือกไฟล์ที่ต้องการอัปโหลด' });
  }

  if (!request_id || !file_type) {
    if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
    return res.status(400).json({ success: false, error: 'กรุณาระบุ request_id และ file_type' });
  }

  try {
    const reqCheck = await db.query('SELECT * FROM expense_requests WHERE id = $1', [request_id]);
    if (reqCheck.rows.length === 0) {
      if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
      return res.status(404).json({ success: false, error: 'ไม่พบคำขอเบิกเงินนี้ในระบบ' });
    }

    const currentReq = reqCheck.rows[0];

    const requiredPerm = file_type === 'PAYMENT_SLIP' ? 'file.upload_slip' : 'file.upload_receipt';
    const permRes = await db.query(`
      SELECT p.code FROM role_permissions rp
      JOIN permissions p ON rp.permission_id = p.id
      WHERE rp.role_id = $1 AND p.code = $2
    `, [user.role_id, requiredPerm]);

    if (permRes.rows.length === 0) {
      if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
      await logAudit({
        userId: user.id,
        username: user.username,
        action: 'ACCESS_DENIED',
        resource: 'FILE',
        details: `ไม่มีสิทธิ์ [${requiredPerm}] ในการอัปโหลดไฟล์ประเภท ${file_type}`,
        ipAddress: req.ip,
        status: 'FAILED'
      });
      return res.status(403).json({
        success: false,
        error: `ปฏิเสธการเข้าถึง: บทบาทของคุณไม่มีสิทธิ์อัปโหลดไฟล์ประเภทนี้ [${requiredPerm}]`
      });
    }

    if (file_type === 'PAYMENT_SLIP' && !['APPROVED_MANAGER', 'PAID'].includes(currentReq.status)) {
      if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
      return res.status(400).json({
        success: false,
        error: 'สามารถแนบหลักฐานการโอนเงิน (Payment Slip) ได้ก็ต่อเมื่อคำขอได้รับการอนุมัติจากหัวหน้างานแล้วเท่านั้น'
      });
    }

    const relativePath = path.relative(path.join(__dirname, '../../'), file.path).replace(/\\/g, '/');

    let decodedOriginalName = file.originalname;
    try {
      decodedOriginalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    } catch (e) {
      decodedOriginalName = file.originalname;
    }

    const query = `
      INSERT INTO expense_attachments (
        request_id, file_type, original_name, stored_name, file_path, mime_type, file_size, uploaded_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;
    const result = await db.query(query, [
      request_id,
      file_type,
      decodedOriginalName,
      file.filename,
      relativePath,
      file.mimetype,
      file.size,
      user.id
    ]);

    const created = result.rows[0];

    const actorDisplayName = `${user.full_name} (@${user.username})`;
    await logAudit({
      userId: user.id,
      username: user.username,
      action: 'FILE_UPLOAD',
      resource: 'FILE',
      resourceId: request_id,
      details: `[${actorDisplayName}] อัปโหลดไฟล์ "${decodedOriginalName}" (${(file.size / 1024).toFixed(1)} KB) สำหรับคำขอ #${request_id}`,
      ipAddress: req.ip,
      status: 'SUCCESS'
    });

    res.status(201).json({
      success: true,
      message: 'อัปโหลดไฟล์เรียบร้อยแล้ว',
      data: created
    });

  } catch (err) {
    if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
    console.error('uploadFile error:', err);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการบันทึกไฟล์' });
  }
};

exports.downloadFile = async (req, res) => {
  const { id } = req.params;
  const user = req.user;

  try {
    const fileRes = await db.query(`
      SELECT a.*, e.user_id AS request_owner_id, e.status AS request_status
      FROM expense_attachments a
      JOIN expense_requests e ON a.request_id = e.id
      WHERE a.id = $1
    `, [id]);

    if (fileRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'ไม่พบไฟล์ที่ต้องการ' });
    }

    const file = fileRes.rows[0];

    function renderAccessDeniedHtml(title, message, detailInfo = '') {
      return `<!DOCTYPE html>
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
      background: radial-gradient(circle at 50% 20%, rgba(239, 68, 68, 0.12), transparent 45%),
                  radial-gradient(circle at 80% 80%, rgba(168, 85, 247, 0.08), transparent 45%),
                  #0b0f19;
      font-family: 'Plus Jakarta Sans', 'Sarabun', sans-serif;
      color: #f8fafc;
    }
    .error-card {
      background: rgba(20, 29, 48, 0.85);
      border: 1px solid rgba(239, 68, 68, 0.3);
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6), 0 0 30px rgba(239, 68, 68, 0.15);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border-radius: 20px;
      max-width: 520px;
      width: 100%;
      padding: 2.5rem 2rem;
      text-align: center;
      position: relative;
      overflow: hidden;
      animation: fadeInScale 0.35s ease-out;
    }
    .error-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 4px;
      background: linear-gradient(90deg, #ef4444, #f59e0b, #ef4444);
    }
    .icon-wrapper {
      width: 80px;
      height: 80px;
      border-radius: 24px;
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.35);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 2.5rem;
      margin-bottom: 1.5rem;
      box-shadow: 0 8px 24px rgba(239, 68, 68, 0.25);
    }
    .badge-code {
      display: inline-block;
      font-size: 0.75rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      color: #fca5a5;
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.3);
      padding: 0.25rem 0.75rem;
      border-radius: 999px;
      margin-bottom: 1rem;
      text-transform: uppercase;
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 700;
      color: #ffffff;
      margin: 0 0 0.75rem 0;
      letter-spacing: -0.02em;
    }
    p {
      color: #94a3b8;
      font-size: 0.95rem;
      line-height: 1.6;
      margin: 0 0 1.5rem 0;
    }
    .detail-box {
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 12px;
      padding: 0.85rem 1rem;
      font-size: 0.82rem;
      color: #cbd5e1;
      margin-bottom: 1.8rem;
      text-align: left;
    }
    .detail-box strong {
      color: #38bdf8;
    }
    .btn-group {
      display: flex;
      gap: 0.75rem;
      justify-content: center;
      flex-wrap: wrap;
    }
    .btn-action {
      padding: 0.7rem 1.4rem;
      border-radius: 10px;
      font-size: 0.88rem;
      font-weight: 600;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      transition: all 0.2s ease;
      cursor: pointer;
      border: none;
    }
    .btn-back {
      background: linear-gradient(135deg, #38bdf8 0%, #0284c7 100%);
      color: #0b0f19;
      font-weight: 700;
      box-shadow: 0 4px 15px rgba(56, 189, 248, 0.35);
    }
    .btn-back:hover {
      background: linear-gradient(135deg, #7dd3fc 0%, #0369a1 100%);
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(56, 189, 248, 0.5);
    }
    .btn-close {
      background: rgba(255, 255, 255, 0.08);
      color: #e2e8f0;
      border: 1px solid rgba(255, 255, 255, 0.15);
    }
    .btn-close:hover {
      background: rgba(255, 255, 255, 0.15);
      color: #ffffff;
      transform: translateY(-2px);
    }
    @keyframes fadeInScale {
      from { opacity: 0; transform: scale(0.95); }
      to { opacity: 1; transform: scale(1); }
    }
  </style>
</head>
<body>
  <div class="error-card">
    <div class="icon-wrapper">🛡️</div>
    <div><span class="badge-code">HTTP 403 • FORBIDDEN</span></div>
    <h1>${title}</h1>
    <p>${message}</p>
    ${detailInfo ? `<div class="detail-box">💡 <strong>ข้อมูลเพิ่มเติม:</strong> ${detailInfo}</div>` : ''}
    <div class="btn-group">
      <button class="btn-action btn-close" onclick="window.close()">✕ ปิดหน้านี้</button>
      <a href="/app" class="btn-action btn-back">← กลับสู่หน้าหลัก</a>
    </div>
  </div>
</body>
</html>`;
    }

    const permRes = await db.query(`
      SELECT p.code FROM role_permissions rp
      JOIN permissions p ON rp.permission_id = p.id
      WHERE rp.role_id = $1 AND p.code = 'file.view'
    `, [user.role_id]);

    if (permRes.rows.length === 0) {
      await logAudit({
        userId: user.id,
        username: user.username,
        action: 'ACCESS_DENIED',
        resource: 'FILE',
        resourceId: id,
        details: 'พยายามเปิดดูไฟล์โดยไม่มีสิทธิ์ file.view',
        ipAddress: req.ip,
        status: 'FAILED'
      });

      const errorMsg = 'ปฏิเสธการเข้าถึง: ไม่มีสิทธิ์เปิดดูไฟล์';
      if (req.accepts('html')) {
        return res.status(403).send(renderAccessDeniedHtml(
          'ไม่มีสิทธิ์เปิดดูไฟล์เอกสารแนบ',
          'บทบาทของคุณไม่ได้รับอนุญาตให้ดูหรือดาวน์โหลดไฟล์แนบในระบบ หากต้องการเข้าถึง กรุณาติดต่อผู้ดูแลระบบ (Admin) เพื่อกำหนดสิทธิ์ <code>file.view</code> ในตาราง ACL',
          `สิทธิ์ที่จำเป็น: <code>file.view</code> (บทบาทปัจจุบันของคุณ: <strong>${user.role_name}</strong>)`
        ));
      }
      return res.status(403).json({ success: false, error: errorMsg });
    }

    const isOwner = file.request_owner_id === user.id;
    const isSpecialRole = ['Admin', 'Manager', 'Finance'].includes(user.role_name);

    if (!isOwner && !isSpecialRole) {
      await logAudit({
        userId: user.id,
        username: user.username,
        action: 'ACCESS_DENIED',
        resource: 'FILE',
        resourceId: id,
        details: `พยายามเปิดดูไฟล์ของผู้อื่น (คำขอ #${file.request_id})`,
        ipAddress: req.ip,
        status: 'FAILED'
      });

      const errorMsg = 'ปฏิเสธการเข้าถึง: ท่านไม่ใช่เจ้าของเอกสารนี้';
      if (req.accepts('html')) {
        return res.status(403).send(renderAccessDeniedHtml(
          'ปฏิเสธการเข้าถึงเอกสารแนบ',
          'คุณไม่สามารถเปิดดูไฟล์แนบของคำขอเบิกเงินนี้ได้ เนื่องจากเอกสารนี้เป็นของพนักงานท่านอื่น',
          `เจ้าของเอกสารคือ User ID #${file.request_owner_id} (คำขอเบิกเงิน #${file.request_id})`
        ));
      }
      return res.status(403).json({ success: false, error: errorMsg });
    }

    const absolutePath = path.join(__dirname, '../../', file.file_path);
    if (!fs.existsSync(absolutePath)) {
      if (req.accepts('html')) {
        return res.status(404).send(renderAccessDeniedHtml(
          'ไม่พบไฟล์ในเซิร์ฟเวอร์',
          'ไฟล์ที่คุณต้องการเปิดดูอาจถูกลบหรือไม่มีอยู่ในระบบจัดเก็บไฟล์จริง',
          `ชื่อไฟล์เดิม: <strong>${file.original_name}</strong>`
        ));
      }
      return res.status(404).json({ success: false, error: 'ไม่พบไฟล์จริงใน Server' });
    }

    res.setHeader('Content-Type', file.mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.original_name)}"`);
    fs.createReadStream(absolutePath).pipe(res);

  } catch (err) {
    console.error('downloadFile error:', err);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการเรียกดูไฟล์' });
  }
};

exports.deleteFile = async (req, res) => {
  const { id } = req.params;
  const user = req.user;
  const isAdmin = user.role_name.toLowerCase() === 'admin';

  try {
    const fileRes = await db.query(`
      SELECT a.*, e.user_id AS request_owner_id, e.status AS request_status
      FROM expense_attachments a
      JOIN expense_requests e ON a.request_id = e.id
      WHERE a.id = $1
    `, [id]);

    if (fileRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'ไม่พบไฟล์ที่ต้องการลบ' });
    }

    const file = fileRes.rows[0];

    if (!isAdmin) {
      const isUploader = file.uploaded_by === user.id;

      if (!isUploader) {
        await logAudit({
          userId: user.id,
          username: user.username,
          action: 'ACCESS_DENIED',
          resource: 'FILE',
          resourceId: id,
          details: `พยายามลบไฟล์ "${file.original_name}" ที่ตนเองไม่ได้เป็นผู้อัปโหลด`,
          status: 'FAILED'
        });
        return res.status(403).json({ success: false, error: 'ปฏิเสธการเข้าถึง: ท่านสามารถลบได้เฉพาะไฟล์แนบที่ตนเองเป็นผู้อัปโหลดเท่านั้น' });
      }

      if (file.file_type === 'RECEIPT' && file.request_status === 'PAID') {
        return res.status(400).json({
          success: false,
          error: 'ไม่สามารถลบใบเสร็จของคำขอที่ดำเนินการจ่ายเงินเสร็จสิ้นแล้วได้'
        });
      }
    }

    const absolutePath = path.join(__dirname, '../../', file.file_path);
    if (fs.existsSync(absolutePath)) {
      try {
        fs.unlinkSync(absolutePath);
      } catch (err) {
        console.warn('Cannot delete physical file:', err.message);
      }
    }

    await db.query('DELETE FROM expense_attachments WHERE id = $1', [id]);

    const actorDisplayName = `${user.full_name} (@${user.username})`;
    await logAudit({
      userId: user.id,
      username: user.username,
      action: 'FILE_DELETE',
      resource: 'FILE',
      resourceId: file.request_id,
      details: `[${actorDisplayName}] ลบไฟล์ "${file.original_name}" จากคำขอ #${file.request_id}`,
      ipAddress: req.ip,
      status: 'SUCCESS'
    });

    res.json({ success: true, message: `ลบไฟล์ "${file.original_name}" เรียบร้อยแล้ว` });
  } catch (err) {
    console.error('deleteFile error:', err);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการลบไฟล์' });
  }
};

