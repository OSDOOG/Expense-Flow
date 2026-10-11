const fs = require('fs');
const path = require('path');
const db = require('../config/db');
const { logAudit } = require('../utils/logger');

exports.getExpenses = async (req, res) => {
  const user = req.user;
  const { status, category, search } = req.query;

  try {
    const permQuery = `
      SELECT p.code FROM role_permissions rp
      JOIN permissions p ON rp.permission_id = p.id
      WHERE rp.role_id = $1 AND p.code = 'expense.read_all'
    `;
    const permRes = await db.query(permQuery, [user.role_id]);
    const canReadAll = permRes.rows.length > 0;

    let query = `
      SELECT e.*,
             u.full_name AS requester_name, u.department AS requester_dept,
             m.full_name AS manager_name,
             f.full_name AS finance_name,
             (SELECT COUNT(*) FROM expense_attachments a WHERE a.request_id = e.id) AS attachment_count
      FROM expense_requests e
      JOIN users u ON e.user_id = u.id
      LEFT JOIN users m ON e.manager_id = m.id
      LEFT JOIN users f ON e.finance_id = f.id
      WHERE 1=1
    `;
    const params = [];

    if (!canReadAll) {
      params.push(user.id);
      query += ` AND e.user_id = $${params.length}`;
    }

    if (status) {
      params.push(status);
      query += ` AND e.status = $${params.length}`;
    }

    if (category) {
      params.push(category);
      query += ` AND e.category = $${params.length}`;
    }

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (e.title ILIKE $${params.length} OR e.request_no ILIKE $${params.length})`;
    }

    query += ` ORDER BY e.created_at DESC`;

    const result = await db.query(query, params);
    res.json({ success: true, count: result.rows.length, data: result.rows });
  } catch (err) {
    console.error('getExpenses error:', err);
    res.status(500).json({ success: false, error: 'ไม่สามารถดึงข้อมูลคำขอเบิกได้' });
  }
};

exports.getExpenseById = async (req, res) => {
  const { id } = req.params;
  const user = req.user;

  try {
    const query = `
      SELECT e.*,
             u.full_name AS requester_name, u.department AS requester_dept, u.email AS requester_email,
             m.full_name AS manager_name,
             f.full_name AS finance_name
      FROM expense_requests e
      JOIN users u ON e.user_id = u.id
      LEFT JOIN users m ON e.manager_id = m.id
      LEFT JOIN users f ON e.finance_id = f.id
      WHERE e.id = $1
    `;
    const result = await db.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'ไม่พบคำขอเบิกจ่ายนี้' });
    }

    const expense = result.rows[0];

    const permRes = await db.query(`
      SELECT p.code FROM role_permissions rp
      JOIN permissions p ON rp.permission_id = p.id
      WHERE rp.role_id = $1 AND p.code = 'expense.read_all'
    `, [user.role_id]);
    const canReadAll = permRes.rows.length > 0;

    if (!canReadAll && expense.user_id !== user.id) {
      await logAudit({
        userId: user.id,
        username: user.username,
        action: 'ACCESS_DENIED',
        resource: 'EXPENSE',
        resourceId: id,
        details: 'พยายามเข้าดูคำขอเบิกจ่ายของพนักงานท่านอื่น',
        status: 'FAILED'
      });
      return res.status(403).json({ success: false, error: 'ปฏิเสธการเข้าถึง: ท่านไม่ใช่เจ้าของรายการนี้' });
    }

    const filesRes = await db.query(`
      SELECT id, file_type, original_name, file_size, mime_type, created_at, uploaded_by
      FROM expense_attachments
      WHERE request_id = $1
      ORDER BY id ASC
    `, [id]);

    res.json({
      success: true,
      data: {
        ...expense,
        attachments: filesRes.rows
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการดึงข้อมูล' });
  }
};

exports.createExpense = async (req, res) => {
  const { title, category, total_amount, description, bank_name, bank_account_no } = req.body;
  const user = req.user;

  if (!title || !category || !total_amount) {
    return res.status(400).json({ success: false, error: 'กรุณากรอกข้อมูลสำคัญให้ครบถ้วน' });
  }

  const amount = parseFloat(total_amount);
  if (isNaN(amount) || amount <= 0) {
    return res.status(400).json({ success: false, error: 'ยอดเงินต้องเป็นตัวเลขที่มากกว่า 0' });
  }
  if (amount > 9999999999999999.99) {
    return res.status(400).json({ success: false, error: 'ยอดเงินเกินขีดจำกัดสูงสุดที่ระบบรองรับ' });
  }

  try {
    const currentYear = new Date().getFullYear();
    const prefix = `EXP-${currentYear}-`;

    // ค้นหาเลขที่คำขอล่าสุดของปีปัจจุบัน เพื่อป้องกันการซ้ำกับข้อมูลที่ seed ไว้
    const maxRes = await db.query(
      `SELECT request_no FROM expense_requests 
       WHERE request_no LIKE $1 
       ORDER BY request_no DESC LIMIT 1`,
      [`${prefix}%`]
    );

    let nextNum = 1;
    if (maxRes.rows.length > 0) {
      const lastNo = maxRes.rows[0].request_no;
      const parts = lastNo.split('-');
      const lastSequence = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastSequence)) {
        nextNum = lastSequence + 1;
      }
    }

    const requestNo = `${prefix}${String(nextNum).padStart(4, '0')}`;

    const query = `
      INSERT INTO expense_requests (request_no, user_id, title, category, total_amount, description, bank_name, bank_account_no, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING_MANAGER')
      RETURNING *
    `;
    const result = await db.query(query, [
      requestNo,
      user.id,
      title.trim(),
      category,
      amount,
      description ? description.trim() : null,
      bank_name ? bank_name.trim() : null,
      bank_account_no ? bank_account_no.trim() : null
    ]);

    const created = result.rows[0];

    const bankLog = created.bank_name ? ` (โอนเข้า ${created.bank_name} เลขที่ ${created.bank_account_no || '-'})` : '';
    await logAudit({
      userId: user.id,
      username: user.username,
      action: 'CREATE',
      resource: 'EXPENSE',
      resourceId: created.id,
      details: `สร้างคำขอเบิกเงิน ${requestNo} ยอด ${amount.toLocaleString()} บาท${bankLog}`,
      ipAddress: req.ip,
      status: 'SUCCESS'
    });

    res.status(201).json({
      success: true,
      message: 'สร้างคำขอเบิกจ่ายเรียบร้อยแล้ว',
      data: created
    });
  } catch (err) {
    console.error('createExpense error:', err);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการสร้างคำขอ' });
  }
};

exports.updateExpense = async (req, res) => {
  const { id } = req.params;
  const { title, category, total_amount, description, bank_name, bank_account_no } = req.body;
  const user = req.user;
  const isAdmin = user.role_name.toLowerCase() === 'admin';

  if (!title || !category || !total_amount) {
    return res.status(400).json({ success: false, error: 'กรุณากรอกข้อมูลสำคัญให้ครบถ้วน' });
  }

  const amount = parseFloat(total_amount);
  if (isNaN(amount) || amount <= 0) {
    return res.status(400).json({ success: false, error: 'ยอดเงินต้องเป็นตัวเลขที่มากกว่า 0' });
  }
  if (amount > 9999999999999999.99) {
    return res.status(400).json({ success: false, error: 'ยอดเงินเกินขีดจำกัดสูงสุดที่ระบบรองรับ' });
  }

  try {
    const checkRes = await db.query('SELECT * FROM expense_requests WHERE id = $1', [id]);
    if (checkRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'ไม่พบคำขอเบิกจ่ายนี้' });
    }

    const item = checkRes.rows[0];

    if (!isAdmin && item.user_id !== user.id) {
      await logAudit({
        userId: user.id,
        username: user.username,
        action: 'ACCESS_DENIED',
        resource: 'EXPENSE',
        resourceId: id,
        details: 'พยายามแก้ไขคำขอเบิกจ่ายของผู้อื่น',
        status: 'FAILED'
      });
      return res.status(403).json({ success: false, error: 'ปฏิเสธการเข้าถึง: ท่านไม่ใช่เจ้าของคำขอนี้' });
    }

    if (!isAdmin && ['APPROVED_MANAGER', 'PAID'].includes(item.status)) {
      return res.status(400).json({
        success: false,
        error: 'ไม่สามารถแก้ไขคำขอที่ได้รับการอนุมัติหรือจ่ายเงินไปแล้วได้'
      });
    }

    const changes = [];
    if (item.title !== title.trim()) changes.push(`หัวข้อ: "${item.title}" -> "${title.trim()}"`);
    if (item.category !== category) changes.push(`หมวดหมู่: "${item.category}" -> "${category}"`);
    if (Number(item.total_amount) !== amount) changes.push(`ยอดเงิน: ${Number(item.total_amount).toLocaleString()} -> ${amount.toLocaleString()}`);
    if ((item.description || '') !== (description || '').trim()) changes.push(`รายละเอียดถูกปรับปรุง`);
    if (bank_name && item.bank_name !== bank_name.trim()) changes.push(`ธนาคาร: "${item.bank_name || '-'}" -> "${bank_name.trim()}"`);
    if (bank_account_no && item.bank_account_no !== bank_account_no.trim()) changes.push(`เลขบัญชี: "${item.bank_account_no || '-'}" -> "${bank_account_no.trim()}"`);

    const updateQuery = `
      UPDATE expense_requests
      SET title = $1,
          category = $2,
          total_amount = $3,
          description = $4,
          bank_name = COALESCE($5, bank_name),
          bank_account_no = COALESCE($6, bank_account_no),
          updated_at = NOW()
      WHERE id = $7
      RETURNING *
    `;
    const result = await db.query(updateQuery, [
      title.trim(),
      category,
      amount,
      description ? description.trim() : null,
      bank_name ? bank_name.trim() : null,
      bank_account_no ? bank_account_no.trim() : null,
      id
    ]);

    const changeDetails = changes.length > 0 ? changes.join(', ') : 'ไม่มีการเปลี่ยนแปลงฟิลด์หลัก';
    const actorDisplayName = `${user.full_name} (@${user.username})`;
    await logAudit({
      userId: user.id,
      username: user.username,
      action: 'UPDATE',
      resource: 'EXPENSE',
      resourceId: id,
      details: `[${actorDisplayName}] แก้ไขคำขอ ${item.request_no}: ${changeDetails}`,
      ipAddress: req.ip,
      status: 'SUCCESS'
    });

    res.json({
      success: true,
      message: 'แก้ไขรายละเอียดคำขอเรียบร้อยแล้ว',
      data: result.rows[0]
    });
  } catch (err) {
    console.error('updateExpense error:', err);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการแก้ไขคำขอ' });
  }
};

exports.getExpenseAuditLogs = async (req, res) => {
  const { id } = req.params;
  const user = req.user;

  try {
    const expRes = await db.query('SELECT id, user_id, request_no FROM expense_requests WHERE id = $1', [id]);
    if (expRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'ไม่พบคำขอนี้' });
    }

    const exp = expRes.rows[0];
    const isAdmin = user.role_name && user.role_name.toLowerCase() === 'admin';
    if (!isAdmin) {
      return res.status(403).json({ success: false, error: 'ไม่มีสิทธิ์เข้าดูประวัติการดำเนินการ (เฉพาะ Admin เท่านั้น)' });
    }

    const logQuery = `
      SELECT id, username, action, details, created_at, status
      FROM audit_logs
      WHERE (resource IN ('EXPENSE', 'FILE') AND resource_id = $1)
      ORDER BY created_at DESC
    `;
    const logs = await db.query(logQuery, [String(id)]);

    res.json({ success: true, data: logs.rows });
  } catch (err) {
    console.error('getExpenseAuditLogs error:', err);
    res.status(500).json({ success: false, error: 'ไม่สามารถดึงประวัติของคำขอนี้ได้' });
  }
};

exports.processManagerAction = async (req, res) => {
  const { id } = req.params;
  const { action, comment } = req.body;
  const user = req.user;

  if (!['APPROVE', 'REJECT', 'CANCEL_APPROVAL'].includes(action)) {
    return res.status(400).json({ success: false, error: 'Action ต้องเป็น APPROVE, REJECT หรือ CANCEL_APPROVAL เท่านั้น' });
  }

  if (action === 'CANCEL_APPROVAL' && (!comment || !comment.trim())) {
    return res.status(400).json({ success: false, error: 'กรุณาระบุเหตุผลในการยกเลิกการอนุมัติ' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const checkRes = await client.query(`
      SELECT id, request_no, status, total_amount, user_id, manager_id
      FROM expense_requests
      WHERE id = $1
      FOR UPDATE
    `, [id]);

    if (checkRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'ไม่พบรายการคำขอนี้' });
    }

    const item = checkRes.rows[0];

    if (action === 'CANCEL_APPROVAL') {
      if (item.status === 'PAID') {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          error: 'ไม่สามารถยกเลิกการอนุมัติได้ เนื่องจากฝ่ายการเงินดำเนินการจ่ายเงินไปแล้ว'
        });
      }
      if (item.status !== 'APPROVED_MANAGER') {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          error: `ไม่สามารถยกเลิกการอนุมัติได้ เนื่องจากสถานะปัจจุบันคือ [${item.status}]`
        });
      }

      const cancelComment = `[ยกเลิกการอนุมัติ]: ${comment.trim()}`;
      const updateCancelQuery = `
        UPDATE expense_requests
        SET status = 'PENDING_MANAGER',
            manager_id = $1,
            manager_comment = $2,
            manager_action_at = NOW(),
            updated_at = NOW()
        WHERE id = $3
        RETURNING *
      `;
      const updatedRes = await client.query(updateCancelQuery, [user.id, cancelComment, id]);

      await client.query(`
        INSERT INTO audit_logs (user_id, username, action, resource, resource_id, details, ip_address, status)
        VALUES ($1, $2, 'CANCEL_APPROVAL', 'EXPENSE', $3, $4, $5, 'SUCCESS')
      `, [
        user.id,
        user.username,
        id,
        `หัวหน้างาน ${user.full_name} ยกเลิกการอนุมัติคำขอ ${item.request_no}: ${comment.trim()}`,
        req.ip
      ]);

      await client.query('COMMIT');
      return res.json({
        success: true,
        message: 'ยกเลิกการอนุมัติสำเร็จ สถานะถูกเปลี่ยนกลับเป็น "รอพิจารณา"',
        data: updatedRes.rows[0]
      });
    }

    if (item.status !== 'PENDING_MANAGER') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        error: `ไม่สามารถดำเนินการได้ เนื่องจากสถานะปัจจุบันคือ [${item.status}] (อาจมีผู้อนุมัติ/ปฏิเสธไปแล้ว)`
      });
    }

    const newStatus = action === 'APPROVE' ? 'APPROVED_MANAGER' : 'REJECTED';

    const updateQuery = `
      UPDATE expense_requests
      SET status = $1,
          manager_id = $2,
          manager_comment = $3,
          manager_action_at = NOW(),
          updated_at = NOW()
      WHERE id = $4
      RETURNING *
    `;
    const updatedRes = await client.query(updateQuery, [newStatus, user.id, comment ? comment.trim() : null, id]);

    await client.query(`
      INSERT INTO audit_logs (user_id, username, action, resource, resource_id, details, ip_address, status)
      VALUES ($1, $2, $3, 'EXPENSE', $4, $5, $6, 'SUCCESS')
    `, [
      user.id,
      user.username,
      action === 'APPROVE' ? 'APPROVE' : 'REJECT',
      id,
      `หัวหน้างาน ${action === 'APPROVE' ? 'อนุมัติ' : 'ปฏิเสธ'} คำขอ ${item.request_no}: ${comment || '-'}`,
      req.ip
    ]);

    await client.query('COMMIT');

    res.json({
      success: true,
      message: action === 'APPROVE' ? 'อนุมัติคำขอสำเร็จ' : 'ปฏิเสธคำขอสำเร็จ',
      data: updatedRes.rows[0]
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('processManagerAction error:', err);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการดำเนินการ' });
  } finally {
    client.release();
  }
};

exports.processFinancePayout = async (req, res) => {
  const { id } = req.params;
  const { comment } = req.body;
  const user = req.user;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const checkRes = await client.query(`
      SELECT id, request_no, status, total_amount
      FROM expense_requests
      WHERE id = $1
      FOR UPDATE
    `, [id]);

    if (checkRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'ไม่พบรายการคำขอนี้' });
    }

    const item = checkRes.rows[0];
    if (item.status !== 'APPROVED_MANAGER') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        error: `ไม่สามารถจ่ายเงินได้ เนื่องจากสถานะปัจจุบันคือ [${item.status}] (ต้องเป็น APPROVED_MANAGER เท่านั้น)`
      });
    }

    const updateQuery = `
      UPDATE expense_requests
      SET status = 'PAID',
          finance_id = $1,
          finance_comment = $2,
          paid_at = NOW(),
          updated_at = NOW()
      WHERE id = $3
      RETURNING *
    `;
    const updatedRes = await client.query(updateQuery, [user.id, comment || null, id]);

    await client.query(`
      INSERT INTO audit_logs (user_id, username, action, resource, resource_id, details, ip_address, status)
      VALUES ($1, $2, 'PAYOUT', 'EXPENSE', $3, $4, $5, 'SUCCESS')
    `, [
      user.id,
      user.username,
      id,
      `ฝ่ายการเงินดำเนินการจ่ายเงินคำขอ ${item.request_no}: ${comment || '-'}`,
      req.ip
    ]);

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'บันทึกการจ่ายเงินเสร็จสมบูรณ์',
      data: updatedRes.rows[0]
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('processFinancePayout error:', err);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการบันทึกจ่ายเงิน' });
  } finally {
    client.release();
  }
};

exports.deleteExpense = async (req, res) => {
  const { id } = req.params;
  const user = req.user;
  const isAdmin = user.role_name.toLowerCase() === 'admin';

  try {
    const checkRes = await db.query('SELECT * FROM expense_requests WHERE id = $1', [id]);
    if (checkRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'ไม่พบคำขอเบิกจ่ายนี้' });
    }

    const item = checkRes.rows[0];

    if (!isAdmin) {
      if (item.user_id !== user.id) {
        await logAudit({
          userId: user.id,
          username: user.username,
          action: 'ACCESS_DENIED',
          resource: 'EXPENSE',
          resourceId: id,
          details: 'พยายามลบคำขอของผู้อื่นโดยไม่มีสิทธิ์',
          status: 'FAILED'
        });
        return res.status(403).json({ success: false, error: 'ปฏิเสธการเข้าถึง: ท่านไม่ใช่เจ้าของรายการนี้' });
      }

      if (['APPROVED_MANAGER', 'PAID'].includes(item.status)) {
        return res.status(400).json({
          success: false,
          error: 'ไม่สามารถยกเลิก/ลบคำขอที่ได้รับการอนุมัติหรือจ่ายเงินไปแล้วได้'
        });
      }
    }

    const attachFiles = await db.query('SELECT file_path FROM expense_attachments WHERE request_id = $1', [id]);
    for (const af of attachFiles.rows) {
      if (af.file_path) {
        const absPath = path.join(__dirname, '../../', af.file_path);
        if (fs.existsSync(absPath)) {
          try { fs.unlinkSync(absPath); } catch (e) { /* ignore */ }
        }
      }
    }

    await db.query('DELETE FROM expense_attachments WHERE request_id = $1', [id]);
    await db.query('DELETE FROM expense_requests WHERE id = $1', [id]);

    const actorDisplayName = `${user.full_name} (@${user.username})`;
    await logAudit({
      userId: user.id,
      username: user.username,
      action: 'DELETE',
      resource: 'EXPENSE',
      resourceId: id,
      details: `[${actorDisplayName}] ลบคำขอเบิกจ่าย ${item.request_no} (ของ ${item.user_id === user.id ? 'ตนเอง' : 'พนักงาน ID #' + item.user_id}, ยอด ${item.total_amount} บาท)`,
      status: 'SUCCESS'
    });

    res.json({ success: true, message: `ลบคำขอ ${item.request_no} เรียบร้อยแล้ว` });
  } catch (err) {
    console.error('deleteExpense error:', err);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการลบคำขอ' });
  }
};

exports.deleteAllExpenses = async (req, res) => {
  const user = req.user;
  const isAdmin = user.role_name && user.role_name.toLowerCase() === 'admin';

  if (!isAdmin) {
    await logAudit({
      userId: user.id,
      username: user.username,
      action: 'ACCESS_DENIED',
      resource: 'EXPENSE',
      details: 'พยายามลบคำขอเบิกเงินทั้งหมดโดยไม่มีสิทธิ์ผู้ดูแลระบบ',
      status: 'FAILED'
    });
    return res.status(403).json({ success: false, error: 'ปฏิเสธการเข้าถึง: สำหรับผู้ดูแลระบบ (Admin) เท่านั้น' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const countRes = await client.query('SELECT COUNT(*) AS total FROM expense_requests');
    const totalCount = parseInt(countRes.rows[0].total, 10);

    // ฟังก์ชันช่วยลบไฟล์รูปภาพในโฟลเดอร์ uploads โดยไม่ลบ .gitkeep
    const cleanUploadDirs = () => {
      const receiptsDir = path.join(__dirname, '../../uploads/receipts');
      const slipsDir = path.join(__dirname, '../../uploads/slips');
      [receiptsDir, slipsDir].forEach(dir => {
        if (fs.existsSync(dir)) {
          const files = fs.readdirSync(dir);
          for (const file of files) {
            if (file === '.gitkeep') continue;
            const fp = path.join(dir, file);
            try {
              if (fs.statSync(fp).isFile()) fs.unlinkSync(fp);
            } catch (e) { /* ignore */ }
          }
        }
      });
    };

    if (totalCount === 0) {
      // แม้ไม่มีรายการในฐานข้อมูล แต่ก็ช่วยทำความสะอาดไฟล์ขยะที่อาจค้างในโฟลเดอร์
      cleanUploadDirs();
      await client.query('ROLLBACK');
      return res.json({ success: true, message: 'ไม่มีรายการคำขอเบิกจ่ายในระบบ (ล้างไฟล์แนบที่ตกค้างเรียบร้อยแล้ว)' });
    }

    await client.query('DELETE FROM expense_attachments');
    await client.query('DELETE FROM expense_requests');

    // รีเซ็ตเลขลำดับคำขอ (Sequence) ให้กลับมาเริ่มต้นที่ 1 ใหม่
    await client.query(`DROP SEQUENCE IF EXISTS expense_req_seq`);
    await client.query(`ALTER SEQUENCE IF EXISTS expense_requests_id_seq RESTART WITH 1`);
    await client.query(`CREATE SEQUENCE expense_req_seq START 1`);

    // ลบไฟล์จริงในโฟลเดอร์ uploads/receipts และ uploads/slips
    cleanUploadDirs();

    await client.query('COMMIT');

    const actorDisplayName = `${user.full_name} (@${user.username})`;
    await logAudit({
      userId: user.id,
      username: user.username,
      action: 'DELETE',
      resource: 'EXPENSE',
      details: `[${actorDisplayName}] ล้างลบคำขอเบิกจ่ายทั้งหมดในระบบ (${totalCount} รายการ)`,
      status: 'SUCCESS'
    });

    res.json({
      success: true,
      message: `ลบคำขอเบิกจ่ายทั้งหมดสำเร็จ (จำนวน ${totalCount} รายการ)`
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('deleteAllExpenses error:', err);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการลบคำขอทั้งหมด' });
  } finally {
    client.release();
  }
};

