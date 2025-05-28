const { Pool } = require('pg');
const logger = require('../utils/logger');

class DatabaseConnection {
    constructor() {
        this.pool = null;
        this.isConnected = false;
    }

    async connect() {
        try {
            let config;

            if (process.env.DATABASE_URL) {
                config = {
                    connectionString: process.env.DATABASE_URL,
                    max: 20,
                    idleTimeoutMillis: 30000,
                    connectionTimeoutMillis: 10000,
                };
            } else {
                config = {
                    user: process.env.DB_USER || 'steam_user',
                    host: process.env.DB_HOST || 'localhost',
                    database: process.env.DB_NAME || 'steam_booster',
                    password: process.env.DB_PASSWORD || 'steam_password',
                    port: process.env.DB_PORT || 5432,
                    max: 20,
                    idleTimeoutMillis: 30000,
                    connectionTimeoutMillis: 10000,
                };
            }

            this.pool = new Pool(config);

            // Test the connection
            const client = await this.pool.connect();
            await client.query('SELECT NOW()');
            client.release();

            this.isConnected = true;
            logger.info('Successfully connected to PostgreSQL database');
            
            return this.pool;
        } catch (error) {
            this.isConnected = false;
            logger.error('Failed to connect to PostgreSQL database:', error);
            throw error;
        }
    }

    async disconnect() {
        if (this.pool) {
            await this.pool.end();
            this.isConnected = false;
            logger.info('Disconnected from PostgreSQL database');
        }
    }

    getPool() {
        if (!this.isConnected || !this.pool) {
            throw new Error('Database not connected. Call connect() first.');
        }
        return this.pool;
    }

    async query(text, params) {
        try {
            const pool = this.getPool();
            const result = await pool.query(text, params);
            return result;
        } catch (error) {
            logger.error('Database query error:', { query: text, params, error: error.message });
            throw error;
        }
    }

    async transaction(callback) {
        const client = await this.getPool().connect();
        try {
            await client.query('BEGIN');
            const result = await callback(client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Transaction error:', error);
            throw error;
        } finally {
            client.release();
        }
    }
}

// Export a singleton instance
const db = new DatabaseConnection();
module.exports = db;
