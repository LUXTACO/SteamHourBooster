const SteamUser = require('steam-user');
const { v4: uuidv4 } = require('uuid');
const { steamLog, authLog } = require('../utils/logger');
const db = require('../database/connection');

class SteamManager {
    constructor() {
        this.activeClients = new Map(); // accountId -> { client, sessionId, status, games }
    }

    async loginAccount(accountId, credentials, socket) {
        try {
            if (this.activeClients.has(accountId)) {
                throw new Error('Account is already logged in');
            }

            const sessionId = uuidv4();
            const client = new SteamUser({
                dataDirectory: null,
                autoRelogin: false,
                debug: true
            });

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

            // Handle submitted Steam Guard code
            socket.on('submitSteamGuard', async (data) => {
                if (data.accountId === accountId && clientInfo.guardCallback) {
                    const code = data.code.trim();
                    steamLog.account(accountId, 'Processing Steam Guard code', { 
                        sessionId,
                        codeLength: code.length 
                    });
                    
                    authLog.info('Steam Guard code received', {
                        accountId,
                        sessionId,
                        status: 'processing_code'
                    });

                    clientInfo.guardCallback(code);
                    clientInfo.guardCallback = null;
                }
            });

            this.setupClientEventHandlers(client, accountId, sessionId, socket);

            const loginOptions = {
                accountName: credentials.username,
                password: credentials.password
            };

            if (credentials.twoFactorCode) {
                loginOptions.twoFactorCode = credentials.twoFactorCode;
            }

            // Set login timeout
            const loginTimeout = setTimeout(async () => {
                const info = this.activeClients.get(accountId);
                if (info && info.status === 'connecting') {
                    steamLog.error('Login attempt timed out', { accountId, sessionId });
                    socket.emit('loginError', {
                        accountId,
                        sessionId,
                        error: 'Login attempt timed out after 30 seconds'
                    });
                    await this.disconnectAccount(accountId);
                }
            }, 30000);

            clientInfo.loginTimeout = loginTimeout;
            client.logOn(loginOptions);

            steamLog.account(accountId, 'Login attempt started', {
                username: credentials.username,
                sessionId
            });

            return sessionId;
        } catch (error) {
            steamLog.error('Failed to start login process', {
                accountId,
                error: error.message
            });
            throw error;
        }
    }

    setupClientEventHandlers(client, accountId, sessionId, socket) {
        client.on('loggedOn', async () => {
            try {
                const clientInfo = this.activeClients.get(accountId);
                if (!clientInfo) return;

                if (clientInfo.loginTimeout) {
                    clearTimeout(clientInfo.loginTimeout);
                    delete clientInfo.loginTimeout;
                }

                clientInfo.status = 'logged_in';
                clientInfo.steamId = client.steamID.getSteamID64();

                await this.saveSessionToDatabase(accountId, sessionId, clientInfo.steamId);

                steamLog.account(accountId, 'Successfully logged into Steam', {
                    sessionId,
                    steamId: clientInfo.steamId
                });

                socket.emit('loginSuccess', {
                    accountId,
                    sessionId,
                    steamId: clientInfo.steamId,
                    message: 'Successfully logged into Steam!'
                });

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
                if (!clientInfo) return;

                if (clientInfo.loginTimeout) {
                    clearTimeout(clientInfo.loginTimeout);
                    delete clientInfo.loginTimeout;
                }

                clientInfo.status = 'error';
                const errorMessage = err.message.toLowerCase();
                let errorType = 'unknown';
                let needsTwoFactor = false;

                if (errorMessage.includes('invalid password')) {
                    errorType = 'invalid_password';
                } else if (errorMessage.includes('invalid 2fa')) {
                    errorType = 'invalid_2fa';
                    needsTwoFactor = true;
                } else if (errorMessage.includes('requires twofactor')) {
                    errorType = 'needs_2fa';
                    needsTwoFactor = true;
                } else if (errorMessage.includes('rate limit exceeded')) {
                    errorType = 'rate_limited';
                }

                steamLog.account(accountId, 'Steam login error', {
                    sessionId,
                    errorType,
                    error: err.message
                });

                authLog.error('Authentication failed', {
                    accountId,
                    sessionId,
                    errorType,
                    needsTwoFactor,
                    message: err.message
                });

                socket.emit('loginError', {
                    accountId,
                    sessionId,
                    errorType,
                    needsTwoFactor,
                    error: err.message
                });

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
            if (!clientInfo) return;

            clientInfo.status = 'awaiting_guard';
            clientInfo.guardCallback = callback;

            const guardType = domain ? 'email' : 'mobile_2fa';

            steamLog.account(accountId, 'Steam Guard required', {
                sessionId,
                guardType,
                domain
            });

            authLog.info('Steam Guard challenged', {
                accountId,
                sessionId,
                guardType,
                domain,
                status: 'awaiting_code'
            });

            socket.emit('steamGuardRequired', {
                accountId,
                sessionId,
                guardType,
                domain
            });
        });

        client.on('disconnected', async () => {
            try {
                steamLog.account(accountId, 'Disconnected from Steam', { sessionId });
                await this.endSessionInDatabase(sessionId);
                await this.updateAccountStatus(accountId, 'offline');
                
                this.activeClients.delete(accountId);

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

    // Rest of the class remains unchanged
    // ...

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

            // Set online status before starting games
            clientInfo.client.setPersona(SteamUser.EPersonaState.Online);
            
            // Store games in client info
            clientInfo.games = validGameIds;

            // Configure play settings to properly track hours
            clientInfo.client.gamesPlayed(validGameIds, true);

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

    async stopBoosting(accountId, socket) {
        try {
            const clientInfo = this.activeClients.get(accountId);
            if (!clientInfo) {
                throw new Error('Account not found');
            }

            if (clientInfo.status === 'logged_in') {
                clientInfo.client.gamesPlayed([]);
            }

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

    async disconnectAccount(accountId) {
        try {
            const clientInfo = this.activeClients.get(accountId);
            if (!clientInfo) return false;

            if (clientInfo.client && clientInfo.status === 'logged_in') {
                clientInfo.client.logOff();
            }

            this.activeClients.delete(accountId);
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

    getAccountStatus(accountId) {
        const clientInfo = this.activeClients.get(accountId);
        if (!clientInfo) return null;

        return {
            accountId,
            sessionId: clientInfo.sessionId,
            status: clientInfo.status,
            games: clientInfo.games || [],
            steamId: clientInfo.steamId,
            uptime: Date.now() - clientInfo.startTime
        };
    }

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
    }

    // Database helper methods
    async saveSessionToDatabase(accountId, sessionId, steamId) {
        try {
            await db.query(
                'INSERT INTO sessions (account_id, session_id, steam_id, status) VALUES ($1, $2, $3, $4)',
                [accountId, sessionId, steamId, 'connected']
            );
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
            await db.query(
                'UPDATE sessions SET ended_at = CURRENT_TIMESTAMP, status = $1 WHERE session_id = $2',
                ['disconnected', sessionId]
            );
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
                await db.query(
                    'INSERT INTO boosting_sessions (account_id, session_id, app_id, status) VALUES ($1, $2, $3, $4)',
                    [accountId, sessionDbId, gameId, 'active']
                );
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
            await db.query(`
                UPDATE boosting_sessions 
                SET ended_at = CURRENT_TIMESTAMP, 
                    status = 'completed',
                    duration_seconds = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - started_at))::INTEGER
                WHERE account_id = $1 AND status = 'active'
            `, [accountId]);
        } catch (error) {
            steamLog.error('Failed to end boosting sessions in database', {
                accountId,
                error: error.message
            });
        }
    }

    async updateAccountStatus(accountId, status) {
        try {
            await db.query(
                'UPDATE accounts SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                [status, accountId]
            );
        } catch (error) {
            steamLog.error('Failed to update account status', {
                accountId,
                status,
                error: error.message
            });
        }
    }
}

module.exports = SteamManager;
