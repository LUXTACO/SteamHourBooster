const db = require('../database/connection');
const { dbLog } = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

class Account {
    constructor(data) {
        this.id = data.id;
        this.username = data.username;
        this.password = data.password;
        this.email = data.email;
        this.twoFactorSecret = data.two_factor_secret;
        this.displayName = data.display_name;
        this.status = data.status;
        this.createdAt = data.created_at;
        this.updatedAt = data.updated_at;
        this.lastLogin = data.last_login;
        this.isActive = data.is_active;
    }

    // Create a new account
    static async create(accountData) {
        const startTime = Date.now();
        try {
            const query = `
                INSERT INTO accounts (username, password, email, two_factor_secret, display_name)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING *
            `;
            const values = [
                accountData.username,
                accountData.password,
                accountData.email || null,
                accountData.twoFactorSecret || null,
                accountData.displayName || accountData.username
            ];

            const result = await db.query(query, values);
            dbLog.query(query, values, Date.now() - startTime);
            
            dbLog.info('Account created successfully', { username: accountData.username });
            return new Account(result.rows[0]);
        } catch (error) {
            dbLog.error('Failed to create account', { 
                username: accountData.username, 
                error: error.message 
            });
            throw error;
        }
    }

    // Find account by username
    static async findByUsername(username) {
        const startTime = Date.now();
        try {
            const query = 'SELECT * FROM accounts WHERE username = $1 AND is_active = true';
            const result = await db.query(query, [username]);
            dbLog.query(query, [username], Date.now() - startTime);

            if (result.rows.length === 0) {
                return null;
            }

            return new Account(result.rows[0]);
        } catch (error) {
            dbLog.error('Failed to find account by username', { 
                username, 
                error: error.message 
            });
            throw error;
        }
    }

    // Find account by ID
    static async findById(id) {
        const startTime = Date.now();
        try {
            const query = 'SELECT * FROM accounts WHERE id = $1 AND is_active = true';
            const result = await db.query(query, [id]);
            dbLog.query(query, [id], Date.now() - startTime);

            if (result.rows.length === 0) {
                return null;
            }

            return new Account(result.rows[0]);
        } catch (error) {
            dbLog.error('Failed to find account by ID', { 
                accountId: id, 
                error: error.message 
            });
            throw error;
        }
    }

    // Get all active accounts
    static async getAll() {
        const startTime = Date.now();
        try {
            const query = 'SELECT * FROM accounts WHERE is_active = true ORDER BY created_at ASC';
            const result = await db.query(query);
            dbLog.query(query, [], Date.now() - startTime);

            return result.rows.map(row => new Account(row));
        } catch (error) {
            dbLog.error('Failed to get all accounts', { error: error.message });
            throw error;
        }
    }

    // Update account status
    async updateStatus(status) {
        const startTime = Date.now();
        try {
            const query = `
                UPDATE accounts 
                SET status = $1, updated_at = CURRENT_TIMESTAMP 
                WHERE id = $2 
                RETURNING *
            `;
            const result = await db.query(query, [status, this.id]);
            dbLog.query(query, [status, this.id], Date.now() - startTime);

            if (result.rows.length > 0) {
                this.status = result.rows[0].status;
                this.updatedAt = result.rows[0].updated_at;
            }

            dbLog.info('Account status updated', { 
                accountId: this.id, 
                username: this.username, 
                status 
            });
            return this;
        } catch (error) {
            dbLog.error('Failed to update account status', { 
                accountId: this.id, 
                status, 
                error: error.message 
            });
            throw error;
        }
    }

    // Update last login time
    async updateLastLogin() {
        const startTime = Date.now();
        try {
            const query = `
                UPDATE accounts 
                SET last_login = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP 
                WHERE id = $1 
                RETURNING last_login
            `;
            const result = await db.query(query, [this.id]);
            dbLog.query(query, [this.id], Date.now() - startTime);

            if (result.rows.length > 0) {
                this.lastLogin = result.rows[0].last_login;
            }

            dbLog.info('Account last login updated', { 
                accountId: this.id, 
                username: this.username 
            });
            return this;
        } catch (error) {
            dbLog.error('Failed to update last login', { 
                accountId: this.id, 
                error: error.message 
            });
            throw error;
        }
    }

    // Delete account (soft delete)
    async delete() {
        const startTime = Date.now();
        try {
            const query = `
                UPDATE accounts 
                SET is_active = false, updated_at = CURRENT_TIMESTAMP 
                WHERE id = $1
            `;
            await db.query(query, [this.id]);
            dbLog.query(query, [this.id], Date.now() - startTime);

            this.isActive = false;
            dbLog.info('Account soft deleted', { 
                accountId: this.id, 
                username: this.username 
            });
            return this;
        } catch (error) {
            dbLog.error('Failed to delete account', { 
                accountId: this.id, 
                error: error.message 
            });
            throw error;
        }
    }

    // Update account information
    async update(updateData) {
        const startTime = Date.now();
        try {
            const fields = [];
            const values = [];
            let paramIndex = 1;

            // Build dynamic update query
            if (updateData.password !== undefined) {
                fields.push(`password = $${paramIndex++}`);
                values.push(updateData.password);
            }
            if (updateData.email !== undefined) {
                fields.push(`email = $${paramIndex++}`);
                values.push(updateData.email);
            }
            if (updateData.twoFactorSecret !== undefined) {
                fields.push(`two_factor_secret = $${paramIndex++}`);
                values.push(updateData.twoFactorSecret);
            }
            if (updateData.displayName !== undefined) {
                fields.push(`display_name = $${paramIndex++}`);
                values.push(updateData.displayName);
            }

            if (fields.length === 0) {
                return this; // No updates to make
            }

            fields.push(`updated_at = CURRENT_TIMESTAMP`);
            values.push(this.id);

            const query = `
                UPDATE accounts 
                SET ${fields.join(', ')} 
                WHERE id = $${paramIndex} 
                RETURNING *
            `;

            const result = await db.query(query, values);
            dbLog.query(query, values, Date.now() - startTime);

            if (result.rows.length > 0) {
                Object.assign(this, new Account(result.rows[0]));
            }

            dbLog.info('Account updated', { 
                accountId: this.id, 
                username: this.username,
                updatedFields: Object.keys(updateData)
            });
            return this;
        } catch (error) {
            dbLog.error('Failed to update account', { 
                accountId: this.id, 
                updateData, 
                error: error.message 
            });
            throw error;
        }
    }

    // Get account statistics
    async getStatistics() {
        const startTime = Date.now();
        try {
            const query = `
                SELECT 
                    a.*,
                    COALESCE(stats.total_sessions, 0) as total_sessions,
                    COALESCE(stats.total_boosting_sessions, 0) as total_boosting_sessions,
                    COALESCE(stats.total_hours_boosted, 0) as total_hours_boosted
                FROM accounts a
                LEFT JOIN session_stats_view stats ON a.id = stats.account_id
                WHERE a.id = $1
            `;
            const result = await db.query(query, [this.id]);
            dbLog.query(query, [this.id], Date.now() - startTime);

            return result.rows[0] || null;
        } catch (error) {
            dbLog.error('Failed to get account statistics', { 
                accountId: this.id, 
                error: error.message 
            });
            throw error;
        }
    }

    // Convert to JSON (for API responses)
    toJSON() {
        return {
            id: this.id,
            username: this.username,
            email: this.email,
            displayName: this.displayName,
            status: this.status,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
            lastLogin: this.lastLogin,
            isActive: this.isActive
            // Note: password and twoFactorSecret are intentionally excluded
        };
    }
}

module.exports = Account;
