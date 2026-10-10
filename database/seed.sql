
INSERT INTO roles (id, name, description, is_system_role) VALUES
(1, 'Admin', 'ผู้ดูแลระบบสูงสุด จัดการสิทธิ์ ผู้ใช้ และตรวจสอบ Log ทั้งหมด', TRUE),
(2, 'Manager', 'หัวหน้าแผนก พิจารณาอนุมัติหรือปฏิเสธคำขอเบิกจ่ายในแผนก', FALSE),
(3, 'Finance', 'เจ้าหน้าที่การเงิน ตรวจสอบหลักฐานใบเสร็จ จ่ายเงิน และแนบสลิปโอนเงิน', FALSE),
(4, 'Employee', 'พนักงานทั่วไป ยื่นคำขอเบิกเงิน แนบใบเสร็จ และดูสถานะคำขอตนเอง', FALSE)
ON CONFLICT (id) DO UPDATE SET 
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_system_role = EXCLUDED.is_system_role;

SELECT setval('roles_id_seq', (SELECT MAX(id) FROM roles));

INSERT INTO permissions (id, code, name, module, description) VALUES
(1, 'expense.create', 'สร้างคำขอเบิกจ่ายใหม่', 'EXPENSE', 'สามารถสร้างและยื่นคำขอเบิกเงินพร้อมแนบเอกสาร'),
(2, 'expense.read_own', 'ดูคำขอเบิกจ่ายของตนเอง', 'EXPENSE', 'ดูรายการและประวัติการเบิกจ่ายที่เป็นเจ้าของ'),
(3, 'expense.read_all', 'ดูคำขอเบิกจ่ายทั้งหมด', 'EXPENSE', 'ดูรายการคำขอเบิกจ่ายของพนักงานทุกคนในระบบ'),
(4, 'expense.update_own', 'แก้ไขคำขอของตนเอง', 'EXPENSE', 'แก้ไขรายละเอียดคำขอของตนเองก่อนได้รับการอนุมัติ'),
(5, 'expense.delete_own', 'ยกเลิกคำขอของตนเอง', 'EXPENSE', 'ยกเลิกหรือลบคำขอของตนเองก่อนได้รับการอนุมัติ'),
(6, 'expense.approve_manager', 'อนุมัติ/ปฏิเสธคำขอ (หัวหน้า)', 'EXPENSE', 'พิจารณาอนุมัติหรือปฏิเสธคำขอเบิกเงินขั้นหัวหน้างาน'),
(7, 'expense.process_finance', 'ดำเนินการจ่ายเงิน (การเงิน)', 'EXPENSE', 'ตรวจสอบเอกสารการเงิน บันทึกจ่ายเงิน และปิดยอด'),

(8, 'file.upload_receipt', 'อัปโหลดใบเสร็จรับเงิน', 'FILE', 'อัปโหลดภาพใบเสร็จ/ใบกำกับภาษีประกอบคำขอ'),
(9, 'file.upload_slip', 'อัปโหลดสลิปโอนเงิน', 'FILE', 'อัปโหลดหลักฐานการโอนเงินคืนพนักงาน'),
(10, 'file.view', 'ดูและดาวน์โหลดไฟล์แนบ', 'FILE', 'เปิดดูรูปภาพหรือดาวน์โหลดไฟล์แนบตามสิทธิ์การเข้าถึง'),
(11, 'file.delete', 'ลบไฟล์แนบ', 'FILE', 'ลบไฟล์แนบที่ตนเองอัปโหลดก่อนรายการได้รับการอนุมัติ'),

(12, 'role.manage', 'จัดการบทบาท (Roles)', 'ROLE', 'เพิ่ม แก้ไข และลบ Role ผ่านหน้าเว็บ'),
(13, 'permission.manage', 'จัดการสิทธิ์ (Permissions)', 'PERMISSION', 'เพิ่ม แก้ไข และลบ Permission ผ่านหน้าเว็บ'),
(14, 'acl.manage', 'จัดการตารางสิทธิ์ (ACL Matrix)', 'ACL', 'กำหนดและยกเลิกสิทธิ์ให้ Role ในตาราง Role x Permission'),

(15, 'user.create', 'เพิ่มผู้ใช้งานใหม่', 'USER', 'สร้างบัญชีผู้ใช้งานใหม่ในระบบ'),
(16, 'user.read', 'ดูรายชื่อผู้ใช้งาน', 'USER', 'ดูรายชื่อและข้อมูลผู้ใช้ทั้งหมด'),
(17, 'user.update', 'แก้ไขผู้ใช้และเปลี่ยน Role', 'USER', 'แก้ไขข้อมูลผู้ใช้และมอบหมายบทบาทใหม่ผ่านหน้าเว็บ'),
(18, 'user.delete', 'ระงับ/ลบผู้ใช้งาน', 'USER', 'ระงับการใช้งานหรือลบบัญชีผู้ใช้'),

(19, 'log.read', 'ดูประวัติการใช้งาน (Audit Log)', 'LOG', 'ค้นหา กรอง และเรียกดูประวัติ Audit Log ย้อนหลัง')
ON CONFLICT (id) DO UPDATE SET 
    code = EXCLUDED.code,
    name = EXCLUDED.name,
    module = EXCLUDED.module,
    description = EXCLUDED.description;

SELECT setval('permissions_id_seq', (SELECT MAX(id) FROM permissions));

DELETE FROM role_permissions;

INSERT INTO role_permissions (role_id, permission_id)
SELECT 1, id FROM permissions;

INSERT INTO role_permissions (role_id, permission_id) VALUES
(2, 2),
(2, 3),
(2, 6),
(2, 10);

INSERT INTO role_permissions (role_id, permission_id) VALUES
(3, 2),
(3, 3),
(3, 7),
(3, 9),
(3, 10);

INSERT INTO role_permissions (role_id, permission_id) VALUES
(4, 1),
(4, 2),
(4, 4),
(4, 5),
(4, 8),
(4, 10);

INSERT INTO users (id, username, password_hash, full_name, email, department, role_id, is_active) VALUES
(1, 'admin', '$2b$10$5ywCUt3/eLrKfw7t82LV9uvBKRvT9dvkFchkdIzUEoV2ATwG0NO8q', 'สมชาย ดูแลระบบ (Admin)', 'admin@company.local', 'IT Administration', 1, TRUE),
(2, 'manager', '$2b$10$5ywCUt3/eLrKfw7t82LV9uvBKRvT9dvkFchkdIzUEoV2ATwG0NO8q', 'วิชัย จัดการ (Manager)', 'manager@company.local', 'Sales & Marketing', 2, TRUE),
(3, 'finance', '$2b$10$5ywCUt3/eLrKfw7t82LV9uvBKRvT9dvkFchkdIzUEoV2ATwG0NO8q', 'สุภาพร การเงิน (Finance)', 'finance@company.local', 'Accounting & Finance', 3, TRUE),
(4, 'employee', '$2b$10$5ywCUt3/eLrKfw7t82LV9uvBKRvT9dvkFchkdIzUEoV2ATwG0NO8q', 'กิตติศักดิ์ พนักงาน (Employee)', 'employee@company.local', 'Sales & Marketing', 4, TRUE),
(5, 'employee2', '$2b$10$5ywCUt3/eLrKfw7t82LV9uvBKRvT9dvkFchkdIzUEoV2ATwG0NO8q', 'อนัญญา สดใส (Employee 2)', 'ananya@company.local', 'Human Resources', 4, TRUE)
ON CONFLICT (id) DO UPDATE SET 
    username = EXCLUDED.username,
    password_hash = EXCLUDED.password_hash,
    full_name = EXCLUDED.full_name,
    email = EXCLUDED.email,
    department = EXCLUDED.department,
    role_id = EXCLUDED.role_id,
    is_active = EXCLUDED.is_active;

SELECT setval('users_id_seq', (SELECT MAX(id) FROM users));

INSERT INTO expense_requests (
    id, request_no, user_id, title, category, total_amount, description, 
    status, manager_id, manager_comment, manager_action_at, 
    finance_id, finance_comment, paid_at, created_at
) VALUES
(1, 'EXP-2026-0001', 4, 'ค่าเดินทางและที่พักพบลูกค้าจังหวัดเชียงใหม่', 'Travel', 4250.00, 
 'เข้าพบลูกค้ารายใหญ่ บริษัท นอร์ทเทิร์นเทค จำกัด เพื่อเซ็นสัญญาโครงการ Cloud', 
 'PENDING_MANAGER', NULL, NULL, NULL, NULL, NULL, NULL, NOW() - INTERVAL '2 days'),

(2, 'EXP-2026-0002', 4, 'ค่าจัดซื้อสายสัญญาณและอุปกรณ์เน็ตเวิร์กสำรอง', 'Equipment', 1890.00, 
 'ซื้อสาย LAN Cat6 และ Switch 8-Port สำหรับติดตั้งห้องประชุมชั้น 3 ด่วน', 
 'APPROVED_MANAGER', 2, 'อนุมัติตามที่เสนอ จำเป็นต่อการประชุมประจำไตรมาส', NOW() - INTERVAL '1 day', NULL, NULL, NULL, NOW() - INTERVAL '3 days'),

(3, 'EXP-2026-0003', 5, 'ค่าอาหารรับรองลูกค้าร่วมประชุมสัมมนาประจำปี', 'Meals', 2700.00, 
 'ค่าอาหารมื้อกลางวันและเครื่องดื่มสำหรับทีมที่ปรึกษาภายนอก 5 ท่าน', 
 'PAID', 2, 'เห็นชอบ เอกสารครบถ้วน', NOW() - INTERVAL '5 days', 
 3, 'โอนเงินเข้าบัญชีเรียบร้อย เลขที่อ้างอิง KBANK-98214', NOW() - INTERVAL '4 days', NOW() - INTERVAL '7 days'),

(4, 'EXP-2026-0004', 5, 'ค่าของขวัญและกระเช้าเยี่ยมชมงาน', 'Other', 3500.00, 
 'จัดซื้อของขวัญเนื่องในโอกาสเปิดสาขาใหม่ของพันธมิตร', 
 'REJECTED', 2, 'ไม่อนุมัติ เนื่องจากอยู่นอกเหนืองบประมาณฝ่ายประจำไตรมาสนี้ แนะนำให้เบิกผ่านงบกลาง', NOW() - INTERVAL '10 days', 
 NULL, NULL, NULL, NOW() - INTERVAL '12 days')
ON CONFLICT (id) DO UPDATE SET 
    request_no = EXCLUDED.request_no,
    status = EXCLUDED.status;

SELECT setval('expense_requests_id_seq', (SELECT MAX(id) FROM expense_requests));

INSERT INTO expense_attachments (
    id, request_id, file_type, original_name, stored_name, 
    file_path, mime_type, file_size, uploaded_by, created_at
) VALUES
(1, 1, 'RECEIPT', 'hotel_receipt_chiangmai.pdf', 'receipt_6f8b91a2-1111-4b72-887e-001.pdf', 'uploads/receipts/receipt_6f8b91a2-1111-4b72-887e-001.pdf', 'application/pdf', 384912, 4, NOW() - INTERVAL '2 days'),
(2, 2, 'RECEIPT', 'it_accessories_invoice.jpg', 'receipt_7a2c4e81-2222-49bf-a23d-002.jpg', 'uploads/receipts/receipt_7a2c4e81-2222-49bf-a23d-002.jpg', 'image/jpeg', 542100, 4, NOW() - INTERVAL '3 days'),
(3, 3, 'RECEIPT', 'restaurant_tax_invoice.png', 'receipt_8b3d5f92-3333-40cf-b34e-003.png', 'uploads/receipts/receipt_8b3d5f92-3333-40cf-b34e-003.png', 'image/png', 681204, 5, NOW() - INTERVAL '7 days'),
(4, 3, 'PAYMENT_SLIP', 'bank_transfer_slip_exp0003.jpg', 'slip_9c4e6a03-4444-41df-c45f-004.jpg', 'uploads/slips/slip_9c4e6a03-4444-41df-c45f-004.jpg', 'image/jpeg', 248900, 3, NOW() - INTERVAL '4 days')
ON CONFLICT (id) DO UPDATE SET 
    stored_name = EXCLUDED.stored_name;

SELECT setval('expense_attachments_id_seq', (SELECT MAX(id) FROM expense_attachments));

INSERT INTO audit_logs (id, user_id, username, action, resource, resource_id, details, ip_address, status, created_at) VALUES
(1, 1, 'admin', 'LOGIN_SUCCESS', 'AUTH', NULL, 'ผู้ดูแลระบบเข้าสู่ระบบสำเร็จ', '127.0.0.1', 'SUCCESS', NOW() - INTERVAL '2 hours'),
(2, 4, 'employee', 'CREATE', 'EXPENSE', '1', 'สร้างคำขอเบิกจ่าย EXP-2026-0001 (ยอด 4,250.00 บาท)', '192.168.1.45', 'SUCCESS', NOW() - INTERVAL '2 days'),
(3, 4, 'employee', 'FILE_UPLOAD', 'FILE', '1', 'อัปโหลดใบเสร็จ hotel_receipt_chiangmai.pdf (384 KB)', '192.168.1.45', 'SUCCESS', NOW() - INTERVAL '2 days'),
(4, 2, 'manager', 'UPDATE', 'EXPENSE', '2', 'อนุมัติคำขอเบิกจ่าย EXP-2026-0002 ขั้นหัวหน้างาน', '192.168.1.20', 'SUCCESS', NOW() - INTERVAL '1 day'),
(5, 3, 'finance', 'UPDATE', 'EXPENSE', '3', 'บันทึกการจ่ายเงิน EXP-2026-0003 สำเร็จ', '192.168.1.33', 'SUCCESS', NOW() - INTERVAL '4 days'),
(6, 4, 'employee', 'ACCESS_DENIED', 'FILE', '4', 'พยายามเปิดดูสลิปโอนเงินรายการที่ไม่ใช่ของตนเอง ถูกปฏิเสธสิทธิ์ (403 Forbidden)', '192.168.1.45', 'FAILED', NOW() - INTERVAL '30 minutes')
ON CONFLICT (id) DO UPDATE SET 
    username = EXCLUDED.username;

SELECT setval('audit_logs_id_seq', (SELECT MAX(id) FROM audit_logs));
