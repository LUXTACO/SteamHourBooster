const SteamUser = require('steam-user');
const { v4: uuidv4 } = require('uuid');
const { steamLog } = require('../utils/logger');
const db = require('../database/connection');

class SteamManager {
    constructor() {
        this.activeClients = new Map(); // accountId -> { client, sessionId, status, games }
        this.sessions = new Map(); // sessionId -> sessionData
    }

    // Login to Steam with account credentials
    async loginAccount(accountId, credentials, socket) {
        try {
            // Check if account is already logged in
            if (this.activeClients.has(accountId)) {
                throw new Error('Account is already logged in');
            }

            const sessionId = uuidv4();
            const client = new SteamUser({
                dataDirectory: null, // Disable file persistence
                autoRelogin: false, // Disable auto-relogin
                debug: true // Enable debug logging
            });

            // Store client info
            const clientInfo = {
                client,
                sessionId,
                status: 'connecting',
                games: [],
                socket,
                accountId,
                startTime: Date.now()
            };

            this.activeClients.set(accountId, clientInfo);
            this.sessions.set(sessionId, clientInfo);

            // Set up event handlers
            this.setupClientEventHandlers(client, accountId, sessionId, socket);

            // Attempt login
            const loginOptions = {
                accountName: credentials.username,
                password: credentials.password
            };

            if (credentials.twoFactorCode) {
                loginOptions.twoFactorCode = credentials.twoFactorCode;
            }

            // Set a timeout for the login attempt
            const loginTimeout = setTimeout(async () => {
                const clientInfo = this.activeClients.get(accountId);
                if (clientInfo && clientInfo.status === 'connecting') {
                    steamLog.error('Login attempt timed out', { accountId, sessionId });
                    socket.emit('loginError', { 
                        accountId,
                        sessionId,
                        error: 'Login attempt timed out after 30 seconds' 
                    });
                    await this.disconnectAccount(accountId);
                }
            }, 30000);

            client.logOn(loginOptions);

            steamLog.account(accountId, 'Login attempt started', { 
                username: credentials.username,
                sessionId 
            });

            // Add timeout reference to client info
            clientInfo.loginTimeout = loginTimeout;

            return sessionId;
        } catch (error) {
            steamLog.error('Failed to start login process', { 
                accountId, 
                error: error.message 
            });
            throw error;
        }
    }

    // Setup event handlers for Steam client
    setupClientEventHandlers(client, accountId, sessionId, socket) {
        client.on('loggedOn', async () => {
            try {
                const clientInfo = this.activeClients.get(accountId);
                if (clientInfo) {
                    // Clear login timeout
                    if (clientInfo.loginTimeout) {
                        clearTimeout(clientInfo.loginTimeout);
                        delete clientInfo.loginTimeout;
                    }
                    
                    clientInfo.status = 'logged_in';
                    clientInfo.steamId = client.steamID.getSteamID64();
                }

                // Save session to database
                await this.saveSessionToDatabase(accountId, sessionId, client.steamID.getSteamID64());

                steamLog.account(accountId, 'Successfully logged into Steam', { 
                    sessionId,
                    steamId: client.steamID.getSteamID64()
                });

                socket.emit('loginSuccess', {
                    accountId,
                    sessionId,
                    steamId: client.steamID.getSteamID64(),
                    message: 'Successfully logged into Steam!'
                });

                // Update account status in database
                await this.updateAccountStatus(accountId, 'online');

            } catch (error) {
                steamLog.error('Error handling loggedOn event', { 
                    accountId, 
                    sessionId, 
                    error: error.message 
                });
            }
        });

        client.on('error', async (err) => {
            try {
                const clientInfo = this.activeClients.get(accountId);
                if (clientInfo) {
                    // Clear login timeout
                    if (clientInfo.loginTimeout) {
                        clearTimeout(clientInfo.loginTimeout);
                        delete clientInfo.loginTimeout;
                    }
                    
                    clientInfo.status = 'error';
                }

                steamLog.account(accountId, 'Steam login error', { 
                    sessionId, 
                    error: err.message 
                });

                socket.emit('loginError', { 
                    accountId,
                    sessionId,
                    error: err.message 
                });

                // Clean up failed connection
                await this.disconnectAccount(accountId);

            } catch (error) {
                steamLog.error('Error handling error event', { 
                    accountId, 
                    sessionId, 
                    error: error.message 
                });
            }
        });

        client.on('steamGuard', (domain, callback) => {
            const clientInfo = this.activeClients.get(accountId);
            if (clientInfo) {
                clientInfo.status = 'awaiting_guard';
                clientInfo.guardCallback = callback;
            }

            steamLog.account(accountId, 'Steam Guard required', { 
                sessionId, 
                domain 
            });

            socket.emit('steamGuardRequired', { 
                accountId,
                sessionId,
                domain 
            });

            // Set up one-time listener for Steam Guard code
            socket.once(`steamGuardCode_${accountId}`, (code) => {
                steamLog.account(accountId, 'Steam Guard code received', { sessionId });
                callback(code);
            });
        });

        client.on('disconnected', async () => {
            try {
                steamLog.account(accountId, 'Disconnected from Steam', { sessionId });

                // End session in database
                await this.endSessionInDatabase(sessionId);

                // Update account status
                await this.updateAccountStatus(accountId, 'offline');

                // Clean up
                this.activeClients.delete(accountId);
                this.sessions.delete(sessionId);

                socket.emit('disconnected', { 
                    accountId,
                    sessionId,
                    message: 'Disconnected from Steam' 
                });

            } catch (error) {
                steamLog.error('Error handling disconnect event', { 
                    accountId, 
                    sessionId, 
                    error: error.message 
                });
            }
        });
    }

    // Start boosting games for an account
    async startBoosting(accountId, gameIds, socket) {
        try {
            const clientInfo = this.activeClients.get(accountId);
            if (!clientInfo || clientInfo.status !== 'logged_in') {
                throw new Error('Account not logged in');
            }

            const validGameIds = gameIds.map(id => parseInt(id)).filter(id => !isNaN(id));
            if (validGameIds.length === 0) {
                throw new Error('No valid game IDs provided');
            }

            clientInfo.games = validGameIds;
            clientInfo.client.gamesPlayed(validGameIds);

            // Save boosting sessions to database
            await this.saveBoostingSessionsToDatabase(accountId, clientInfo.sessionId, validGameIds);

            steamLog.boosting(accountId, validGameIds.join(','), 'Started boosting games', {
                sessionId: clientInfo.sessionId,
                gameCount: validGameIds.length
            });

            socket.emit('boostingStarted', {
                accountId,
                sessionId: clientInfo.sessionId,
                games: validGameIds,
                message: `Started boosting ${validGameIds.length} game(s)`
            });

            return validGameIds;
        } catch (error) {
            steamLog.error('Failed to start boosting', { 
                accountId, 
                gameIds, 
                error: error.message 
            });
            throw error;
        }
    }

    // Stop boosting for an account
    async stopBoosting(accountId, socket) {
        try {
            const clientInfo = this.activeClients.get(accountId);
            if (!clientInfo) {
                throw new Error('Account not found');
            }

            if (clientInfo.status === 'logged_in') {
                clientInfo.client.gamesPlayed([]);
            }

            // End boosting sessions in database
            await this.endBoostingSessionsInDatabase(accountId);

            const previousGames = clientInfo.games || [];
            clientInfo.games = [];

            steamLog.boosting(accountId, previousGames.join(','), 'Stopped boosting games', {
                sessionId: clientInfo.sessionId
            });

            socket.emit('boostingStopped', {
                accountId,
                sessionId: clientInfo.sessionId,
                previousGames,
                message: 'Stopped boosting all games'
            });

            return true;
        } catch (error) {
            steamLog.error('Failed to stop boosting', { 
                accountId, 
                error: error.message 
            });
            throw error;
        }
    }

    // Disconnect an account
    async disconnectAccount(accountId) {
        try {
            const clientInfo = this.activeClients.get(accountId);
            if (!clientInfo) {
                return false;
            }

            if (clientInfo.client && clientInfo.status === 'logged_in') {
                clientInfo.client.logOff();
            }

            // Clean up immediately
            this.activeClients.delete(accountId);
            this.sessions.delete(clientInfo.sessionId);

            await this.updateAccountStatus(accountId, 'offline');

            steamLog.account(accountId, 'Account disconnected manually', {
                sessionId: clientInfo.sessionId
            });

            return true;
        } catch (error) {
            steamLog.error('Failed to disconnect account', { 
                accountId, 
                error: error.message 
            });
            throw error;
        }
    }

    // Get status of all active accounts
    getActiveAccounts() {
        const accounts = [];
        for (const [accountId, clientInfo] of this.activeClients) {
            accounts.push({
                accountId,
                sessionId: clientInfo.sessionId,
                status: clientInfo.status,
                games: clientInfo.games || [],
                steamId: clientInfo.steamId,
                uptime: Date.now() - clientInfo.startTime
            });
        }
        return accounts;
    }

    // Get specific account status
    getAccountStatus(accountId) {
        const clientInfo = this.activeClients.get(accountId);
        if (!clientInfo) {
            return null;
        }

        return {
            accountId,
            sessionId: clientInfo.sessionId,
            status: clientInfo.status,
            games: clientInfo.games || [],
            steamId: clientInfo.steamId,
            uptime: Date.now() - clientInfo.startTime
        };
    }

    // Database helper methods
    async saveSessionToDatabase(accountId, sessionId, steamId) {
        try {
            const query = `
                INSERT INTO sessions (account_id, session_id, steam_id, status)
                VALUES ($1, $2, $3, $4)
            `;
            await db.query(query, [accountId, sessionId, steamId, 'connected']);
        } catch (error) {
            steamLog.error('Failed to save session to database', { 
                accountId, 
                sessionId, 
                error: error.message 
            });
        }
    }

    async endSessionInDatabase(sessionId) {
        try {
            const query = `
                UPDATE sessions 
                SET ended_at = CURRENT_TIMESTAMP, status = 'disconnected'
                WHERE session_id = $1
            `;
            await db.query(query, [sessionId]);
        } catch (error) {
            steamLog.error('Failed to end session in database', { 
                sessionId, 
                error: error.message 
            });
        }
    }

    async saveBoostingSessionsToDatabase(accountId, sessionId, gameIds) {
        try {
            const sessionResult = await db.query(
                'SELECT id FROM sessions WHERE session_id = $1',
                [sessionId]
            );

            if (sessionResult.rows.length === 0) {
                throw new Error('Session not found');
            }

            const sessionDbId = sessionResult.rows[0].id;

            for (const gameId of gameIds) {
                const query = `
                    INSERT INTO boosting_sessions (account_id, session_id, app_id, status)
                    VALUES ($1, $2, $3, $4)
                `;
                await db.query(query, [accountId, sessionDbId, gameId, 'active']);
            }
        } catch (error) {
            steamLog.error('Failed to save boosting sessions to database', { 
                accountId, 
                sessionId, 
                gameIds, 
                error: error.message 
            });
        }
    }

    async endBoostingSessionsInDatabase(accountId) {
        try {
            const query = `
                UPDATE boosting_sessions 
                SET ended_at = CURRENT_TIMESTAMP, 
                    status = 'completed',
                    duration_seconds = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - started_at))::INTEGER
                WHERE account_id = $1 AND status = 'active'
            `;
            await db.query(query, [accountId]);
        } catch (error) {
            steamLog.error('Failed to end boosting sessions in database', { 
                accountId, 
                error: error.message 
            });
        }
    }

    async updateAccountStatus(accountId, status) {
        try {
            const query = `
                UPDATE accounts 
                SET status = $1, updated_at = CURRENT_TIMESTAMP 
                WHERE id = $2
            `;
            await db.query(query, [status, accountId]);
        } catch (error) {
            steamLog.error('Failed to update account status', { 
                accountId, 
                status, 
                error: error.message 
            });
        }
    }

    // Cleanup all connections
    async cleanup() {
        steamLog.info('Cleaning up all Steam connections');
        
        for (const [accountId, clientInfo] of this.activeClients) {
            try {
                if (clientInfo.client && clientInfo.status === 'logged_in') {
                    clientInfo.client.logOff();
                }
                await this.endSessionInDatabase(clientInfo.sessionId);
                await this.updateAccountStatus(accountId, 'offline');
            } catch (error) {
                steamLog.error('Error during cleanup', { accountId, error: error.message });
            }
        }

        this.activeClients.clear();
        this.sessions.clear();
    }
}

module.exports = SteamManager;
