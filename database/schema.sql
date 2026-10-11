
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS expense_attachments CASCADE;
DROP TABLE IF EXISTS expense_requests CASCADE;
DROP TABLE IF EXISTS role_permissions CASCADE;
DROP TABLE IF EXISTS permissions CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS roles CASCADE;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE roles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,             -- e.g., 'Admin', 'Manager', 'Finance', 'Employee'
    description VARCHAR(255),
    is_system_role BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE permissions (
    id SERIAL PRIMARY KEY,
    code VARCHAR(100) NOT NULL UNIQUE,            
    name VARCHAR(150) NOT NULL,
    module VARCHAR(50) NOT NULL,                
    description VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE role_permissions (
    role_id INT NOT NULL,
    permission_id INT NOT NULL,
    granted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (role_id, permission_id),
    CONSTRAINT fk_role_permissions_role 
        FOREIGN KEY (role_id) REFERENCES roles (id) 
        ON DELETE CASCADE,
    CONSTRAINT fk_role_permissions_permission 
        FOREIGN KEY (permission_id) REFERENCES permissions (id) 
        ON DELETE CASCADE
);

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    department VARCHAR(100) DEFAULT 'General',    -- แผนก เช่น IT, Marketing, Accounting, Management
    role_id INT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_users_role 
        FOREIGN KEY (role_id) REFERENCES roles (id) 
        ON DELETE RESTRICT
);

CREATE TABLE expense_requests (
    id SERIAL PRIMARY KEY,
    request_no VARCHAR(30) NOT NULL UNIQUE,
    user_id INT NOT NULL,
    title VARCHAR(200) NOT NULL,                  -- หัวข้อการเบิก เช่น "ค่าเดินทางพบลูกค้าโครงการ A"
    category VARCHAR(50) NOT NULL,
    total_amount NUMERIC(18, 2) NOT NULL CHECK (total_amount > 0),
    description TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING_MANAGER' 
        CHECK (status IN ('PENDING_MANAGER', 'APPROVED_MANAGER', 'PAID', 'REJECTED')),
    
    bank_name VARCHAR(100),
    bank_account_no VARCHAR(50),
    
    manager_id INT,
    manager_comment TEXT,
    manager_action_at TIMESTAMP WITH TIME ZONE,
    
    finance_id INT,
    finance_comment TEXT,
    paid_at TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_expense_requester FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT fk_expense_manager FOREIGN KEY (manager_id) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT fk_expense_finance FOREIGN KEY (finance_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE expense_attachments (
    id SERIAL PRIMARY KEY,
    request_id INT NOT NULL,
    file_type VARCHAR(30) NOT NULL CHECK (file_type IN ('RECEIPT', 'PAYMENT_SLIP')),
    original_name VARCHAR(255) NOT NULL,
    stored_name VARCHAR(255) NOT NULL UNIQUE,
    file_path VARCHAR(500) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_size INT NOT NULL,
    uploaded_by INT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_attachments_request 
        FOREIGN KEY (request_id) REFERENCES expense_requests (id) 
        ON DELETE CASCADE,
    CONSTRAINT fk_attachments_uploader 
        FOREIGN KEY (uploaded_by) REFERENCES users (id) 
        ON DELETE RESTRICT
);

CREATE TABLE audit_logs (
    id SERIAL PRIMARY KEY,
    user_id INT,
    username VARCHAR(100) NOT NULL,
    action VARCHAR(50) NOT NULL,
    resource VARCHAR(50) NOT NULL,
    resource_id VARCHAR(50),
    details TEXT,                                 -- คำอธิบายเหตุการณ์ เช่น "User requested unauthorized file #5"
    ip_address VARCHAR(45),
    user_agent VARCHAR(255),
    status VARCHAR(20) NOT NULL DEFAULT 'SUCCESS' CHECK (status IN ('SUCCESS', 'FAILED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_username ON users (username);
CREATE INDEX idx_users_role_id ON users (role_id);
CREATE INDEX idx_role_permissions_role ON role_permissions (role_id);
CREATE INDEX idx_role_permissions_perm ON role_permissions (permission_id);
CREATE INDEX idx_expense_requests_user ON expense_requests (user_id);
CREATE INDEX idx_expense_requests_status ON expense_requests (status);
CREATE INDEX idx_expense_attachments_req ON expense_attachments (request_id);
CREATE INDEX idx_audit_logs_action ON audit_logs (action);
CREATE INDEX idx_audit_logs_resource ON audit_logs (resource);
CREATE INDEX idx_audit_logs_created_at ON audit_logs (created_at DESC);
CREATE INDEX idx_audit_logs_user ON audit_logs (user_id);

CREATE OR REPLACE FUNCTION check_admin_existence_before_user_update()
RETURNS TRIGGER AS $$
DECLARE
    admin_role_id INT;
    remaining_admins INT;
BEGIN
    SELECT id INTO admin_role_id FROM roles WHERE LOWER(name) = 'admin' LIMIT 1;

    IF TG_OP = 'DELETE' THEN
        IF OLD.role_id = admin_role_id THEN
            SELECT COUNT(*) INTO remaining_admins 
            FROM users 
            WHERE role_id = admin_role_id AND is_active = TRUE AND id <> OLD.id;

            IF remaining_admins = 0 THEN
                RAISE EXCEPTION 'Cannot delete the last remaining active Admin user.';
            END IF;
        END IF;
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        IF (OLD.role_id = admin_role_id AND (NEW.role_id <> admin_role_id OR NEW.is_active = FALSE)) THEN
            SELECT COUNT(*) INTO remaining_admins 
            FROM users 
            WHERE role_id = admin_role_id AND is_active = TRUE AND id <> OLD.id;

            IF remaining_admins = 0 THEN
                RAISE EXCEPTION 'Cannot modify or deactivate the last remaining active Admin user.';
            END IF;
        END IF;
        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_last_admin_removal ON users;
CREATE TRIGGER trg_prevent_last_admin_removal
BEFORE UPDATE OR DELETE ON users
FOR EACH ROW EXECUTE FUNCTION check_admin_existence_before_user_update();

CREATE OR REPLACE FUNCTION check_role_delete()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.is_system_role = TRUE OR LOWER(OLD.name) = 'admin' THEN
        RAISE EXCEPTION 'Cannot delete system role: %', OLD.name;
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_system_role_delete ON roles;
CREATE TRIGGER trg_prevent_system_role_delete
BEFORE DELETE ON roles
FOR EACH ROW EXECUTE FUNCTION check_role_delete();
