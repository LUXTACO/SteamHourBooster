class SteamHourBooster {
    constructor() {
        this.socket = io('/', {
            transports: ['websocket', 'polling'],
            reconnectionAttempts: 5,
            reconnectionDelay: 1000
        });
        this.accounts = [];
        this.activeAccounts = [];
        this.currentAccountForSteamGuard = null;
        this.currentAccountForBoosting = null;
        this.logs = [];
        
        this.initializeEventListeners();
        this.initializeSocketListeners();
        this.loadAccounts();
    }

    initializeEventListeners() {
        // Add account form
        document.getElementById('addAccountForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.addAccount();
        });

        // Clear logs button
        document.getElementById('clearLogs').addEventListener('click', () => {
            this.clearLogs();
        });

        // Steam Guard modal
        document.getElementById('submitSteamGuard').addEventListener('click', () => {
            this.submitSteamGuard();
        });

        document.getElementById('cancelSteamGuard').addEventListener('click', () => {
            this.hideSteamGuardModal();
        });

        // Game selection modal
        document.getElementById('startBoostingBtn').addEventListener('click', () => {
            this.startBoostingFromModal();
        });

        document.getElementById('cancelGameSelection').addEventListener('click', () => {
            this.hideGameSelectionModal();
        });

        // Popular game buttons
        document.querySelectorAll('.game-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.toggleGameSelection(btn);
            });
        });

        // Enter key handlers
        document.getElementById('steamGuardCode').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.submitSteamGuard();
            }
        });
    }

    initializeSocketListeners() {
        this.socket.on('connect', () => {
            this.updateServerStatus(true);
            this.addLog('Connected to server', 'success');
        });

        this.socket.on('disconnect', () => {
            this.updateServerStatus(false);
            this.addLog('Disconnected from server', 'error');
        });

        this.socket.on('status', (data) => {
            this.updateStatus(data);
        });

        this.socket.on('statusUpdate', (data) => {
            this.updateStatus(data);
        });

        this.socket.on('loginSuccess', (data) => {
            this.addLog(`Account ${data.accountId} logged in successfully`, 'success');
            this.showToast('Login successful!', 'success');
        });

        this.socket.on('loginError', (data) => {
            this.addLog(`Login failed for account ${data.accountId}: ${data.error}`, 'error');
            this.showToast(`Login failed: ${data.error}`, 'error');
        });

        this.socket.on('steamGuardRequired', (data) => {
            this.currentAccountForSteamGuard = data.accountId;
            this.showSteamGuardModal(data.domain);
        });

        this.socket.on('boostingStarted', (data) => {
            this.addLog(`Started boosting ${data.games.length} games for account ${data.accountId}`, 'info');
            this.showToast(`Boosting started for ${data.games.length} games`, 'success');
            this.hideGameSelectionModal();
        });

        this.socket.on('boostingStopped', (data) => {
            this.addLog(`Stopped boosting for account ${data.accountId}`, 'info');
            this.showToast('Boosting stopped', 'warning');
        });

        this.socket.on('accountLoggedOut', (data) => {
            this.addLog(`Account ${data.accountId} logged out`, 'info');
            this.showToast('Account logged out', 'info');
        });

        this.socket.on('error', (data) => {
            this.addLog(`Error for account ${data.accountId}: ${data.error}`, 'error');
            this.showToast(`Error: ${data.error}`, 'error');
        });
    }

    async loadAccounts() {
        try {
            const response = await fetch('/api/accounts');
            if (response.ok) {
                this.accounts = await response.json();
                this.renderAccounts();
                this.updateGlobalStatus();
            } else {
                throw new Error('Failed to load accounts');
            }
        } catch (error) {
            this.addLog(`Failed to load accounts: ${error.message}`, 'error');
            this.showToast('Failed to load accounts', 'error');
        }
    }

    async addAccount() {
        const username = document.getElementById('newUsername').value.trim();
        const password = document.getElementById('newPassword').value.trim();
        const email = document.getElementById('newEmail').value.trim();
        const displayName = document.getElementById('newDisplayName').value.trim();
        const twoFactorSecret = document.getElementById('newTwoFactorSecret').value.trim();

        if (!username || !password) {
            this.showToast('Username and password are required', 'error');
            return;
        }

        try {
            const response = await fetch('/api/accounts', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    username,
                    password,
                    email: email || null,
                    displayName: displayName || username,
                    twoFactorSecret: twoFactorSecret || null
                })
            });

            if (response.ok) {
                const newAccount = await response.json();
                this.accounts.push(newAccount);
                this.renderAccounts();
                this.clearAddAccountForm();
                this.addLog(`Account ${username} added successfully`, 'success');
                this.showToast('Account added successfully', 'success');
            } else {
                const error = await response.json();
                throw new Error(error.error || 'Failed to add account');
            }
        } catch (error) {
            this.addLog(`Failed to add account: ${error.message}`, 'error');
            this.showToast(`Failed to add account: ${error.message}`, 'error');
        }
    }

    clearAddAccountForm() {
        document.getElementById('addAccountForm').reset();
    }

    async deleteAccount(accountId) {
        if (!confirm('Are you sure you want to delete this account?')) {
            return;
        }

        try {
            const response = await fetch(`/api/accounts/${accountId}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                this.accounts = this.accounts.filter(acc => acc.id !== accountId);
                this.renderAccounts();
                this.addLog(`Account deleted successfully`, 'info');
                this.showToast('Account deleted', 'info');
            } else {
                throw new Error('Failed to delete account');
            }
        } catch (error) {
            this.addLog(`Failed to delete account: ${error.message}`, 'error');
            this.showToast('Failed to delete account', 'error');
        }
    }

    loginAccount(accountId) {
        this.socket.emit('loginAccount', { accountId });
        this.addLog(`Attempting to login account ${accountId}`, 'info');
    }

    logoutAccount(accountId) {
        this.socket.emit('logoutAccount', { accountId });
        this.addLog(`Logging out account ${accountId}`, 'info');
    }

    showGameSelectionModal(accountId) {
        this.currentAccountForBoosting = accountId;
        document.getElementById('gameSelectionModal').classList.add('show');
        document.getElementById('gameIdsInput').value = '730\n440\n570'; // Default games
    }

    hideGameSelectionModal() {
        document.getElementById('gameSelectionModal').classList.remove('show');
        this.currentAccountForBoosting = null;
        document.getElementById('gameIdsInput').value = '';
        // Clear selected games
        document.querySelectorAll('.game-btn.selected').forEach(btn => {
            btn.classList.remove('selected');
        });
    }

    toggleGameSelection(button) {
        button.classList.toggle('selected');
        const appId = button.dataset.appid;
        const textarea = document.getElementById('gameIdsInput');
        const currentIds = textarea.value.split('\n').filter(id => id.trim());
        
        if (button.classList.contains('selected')) {
            if (!currentIds.includes(appId)) {
                currentIds.push(appId);
            }
        } else {
            const index = currentIds.indexOf(appId);
            if (index > -1) {
                currentIds.splice(index, 1);
            }
        }
        
        textarea.value = currentIds.join('\n');
    }

    startBoostingFromModal() {
        if (!this.currentAccountForBoosting) {
            return;
        }

        const gameIdsText = document.getElementById('gameIdsInput').value.trim();
        if (!gameIdsText) {
            this.showToast('Please enter at least one game ID', 'error');
            return;
        }

        const gameIds = gameIdsText.split('\n')
            .map(id => id.trim())
            .filter(id => id && !isNaN(id))
            .map(id => parseInt(id));

        if (gameIds.length === 0) {
            this.showToast('Please enter valid game IDs', 'error');
            return;
        }

        this.socket.emit('startBoosting', {
            accountId: this.currentAccountForBoosting,
            gameIds
        });
    }

    stopBoosting(accountId) {
        this.socket.emit('stopBoosting', { accountId });
    }

    showSteamGuardModal(domain) {
        const message = domain ? 
            `Please enter your Steam Guard code sent to ${domain}:` : 
            'Please enter your Steam Guard code:';
        
        document.getElementById('steamGuardMessage').textContent = message;
        document.getElementById('steamGuardModal').classList.add('show');
        document.getElementById('steamGuardCode').focus();
    }

    hideSteamGuardModal() {
        document.getElementById('steamGuardModal').classList.remove('show');
        document.getElementById('steamGuardCode').value = '';
        this.currentAccountForSteamGuard = null;
    }

    submitSteamGuard() {
        const code = document.getElementById('steamGuardCode').value.trim();
        if (!code) {
            this.showToast('Please enter Steam Guard code', 'error');
            return;
        }

        if (this.currentAccountForSteamGuard) {
            this.socket.emit('submitSteamGuard', {
                accountId: this.currentAccountForSteamGuard,
                code
            });
            this.hideSteamGuardModal();
        }
    }

    updateServerStatus(connected) {
        const indicator = document.getElementById('serverStatus');
        const text = document.getElementById('serverStatusText');
        
        if (connected) {
            indicator.classList.add('connected');
            indicator.classList.remove('disconnected');
            text.textContent = 'Connected';
        } else {
            indicator.classList.add('disconnected');
            indicator.classList.remove('connected');
            text.textContent = 'Disconnected';
        }
    }

    updateStatus(data) {
        this.activeAccounts = data.activeAccounts || [];
        this.renderAccounts();
        this.renderActiveSessions();
        this.updateGlobalStatus();
        
        document.getElementById('lastUpdate').textContent = 
            new Date(data.timestamp).toLocaleTimeString();
    }

    updateGlobalStatus() {
        document.getElementById('totalAccounts').textContent = this.accounts.length;
        document.getElementById('activeSessions').textContent = this.activeAccounts.length;
        
        const totalGames = this.activeAccounts.reduce((sum, acc) => 
            sum + (acc.games ? acc.games.length : 0), 0);
        document.getElementById('totalGames').textContent = totalGames;
    }

    renderAccounts() {
        const container = document.getElementById('accountsList');
        
        if (this.accounts.length === 0) {
            container.innerHTML = '<p class="no-accounts">No accounts added yet. Add an account to get started.</p>';
            return;
        }

        container.innerHTML = this.accounts.map(account => {
            const activeAccount = this.activeAccounts.find(active => active.accountId === account.id);
            const status = activeAccount ? activeAccount.status : 'offline';
            const games = activeAccount ? activeAccount.games : [];
            
            return `
                <div class="account-item ${status}" data-account-id="${account.id}">
                    <div class="account-header">
                        <div class="account-info">
                            <h4>${account.displayName}</h4>
                            <div class="account-username">@${account.username}</div>
                        </div>
                        <div class="account-status">
                            <div class="status-dot ${status}"></div>
                            ${this.getStatusText(status)}
                        </div>
                    </div>
                    
                    ${games.length > 0 ? `
                        <div class="account-games">
                            <strong>Boosting Games:</strong>
                            <div class="games-list">
                                ${games.map(gameId => `<span class="game-tag">${gameId}</span>`).join('')}
                            </div>
                        </div>
                    ` : ''}
                    
                    <div class="account-actions">
                        ${this.getAccountActionButtons(account.id, status, games.length > 0)}
                    </div>
                </div>
            `;
        }).join('');

        // Add event listeners to action buttons
        this.attachAccountActionListeners();
    }

    getStatusText(status) {
        const statusMap = {
            'offline': 'Offline',
            'connecting': 'Connecting...',
            'logged_in': 'Online',
            'awaiting_guard': 'Awaiting Steam Guard',
            'error': 'Error'
        };
        return statusMap[status] || 'Unknown';
    }

    getAccountActionButtons(accountId, status, isBoosting) {
        if (status === 'offline') {
            return `
                <button class="btn btn-primary" onclick="steamBooster.loginAccount(${accountId})">
                    Login
                </button>
                <button class="btn btn-danger" onclick="steamBooster.deleteAccount(${accountId})">
                    Delete
                </button>
            `;
        } else if (status === 'connecting' || status === 'awaiting_guard') {
            return `
                <button class="btn btn-secondary" disabled>
                    <span class="spinner"></span>
                    ${status === 'connecting' ? 'Connecting...' : 'Awaiting Auth...'}
                </button>
                <button class="btn btn-danger" onclick="steamBooster.logoutAccount(${accountId})">
                    Cancel
                </button>
            `;
        } else if (status === 'logged_in') {
            return `
                ${isBoosting ? `
                    <button class="btn btn-warning" onclick="steamBooster.stopBoosting(${accountId})">
                        Stop Boosting
                    </button>
                ` : `
                    <button class="btn btn-success" onclick="steamBooster.showGameSelectionModal(${accountId})">
                        Start Boosting
                    </button>
                `}
                <button class="btn btn-secondary" onclick="steamBooster.logoutAccount(${accountId})">
                    Logout
                </button>
            `;
        } else {
            return `
                <button class="btn btn-danger" onclick="steamBooster.logoutAccount(${accountId})">
                    Disconnect
                </button>
            `;
        }
    }

    attachAccountActionListeners() {
        // Event listeners are attached via onclick attributes in the HTML
        // This is simpler for dynamic content but could be improved with delegation
    }

    renderActiveSessions() {
        const container = document.getElementById('sessionsContainer');
        
        if (this.activeAccounts.length === 0) {
            container.innerHTML = '<p class="no-sessions">No active sessions</p>';
            return;
        }

        container.innerHTML = this.activeAccounts.map(session => {
            const account = this.accounts.find(acc => acc.id === session.accountId);
            const uptime = this.formatUptime(session.uptime);
            
            return `
                <div class="session-item">
                    <div class="session-header">
                        <div class="session-info">
                            <h4>${account ? account.displayName : `Account ${session.accountId}`}</h4>
                            <div>Steam ID: ${session.steamId || 'Not available'}</div>
                        </div>
                        <div class="session-uptime">
                            Uptime: ${uptime}
                        </div>
                    </div>
                    ${session.games && session.games.length > 0 ? `
                        <div class="session-games">
                            <strong>Boosting ${session.games.length} games:</strong>
                            <div class="games-list">
                                ${session.games.map(gameId => `<span class="game-tag">${gameId}</span>`).join('')}
                            </div>
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');
    }

    formatUptime(milliseconds) {
        const seconds = Math.floor(milliseconds / 1000);
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        
        if (hours > 0) {
            return `${hours}h ${minutes}m ${secs}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${secs}s`;
        } else {
            return `${secs}s`;
        }
    }

    addLog(message, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = { message, type, timestamp };
        
        this.logs.unshift(logEntry);
        
        // Keep only last 100 logs
        if (this.logs.length > 100) {
            this.logs = this.logs.slice(0, 100);
        }
        
        this.renderLogs();
    }

    renderLogs() {
        const container = document.getElementById('logsContent');
        const logCount = document.getElementById('logCount');
        
        logCount.textContent = this.logs.length;
        
        if (this.logs.length === 0) {
            container.innerHTML = '<p class="no-logs">No logs available</p>';
            return;
        }

        container.innerHTML = this.logs.map(log => `
            <div class="log-entry ${log.type}">
                <span class="log-timestamp">[${log.timestamp}]</span>
                ${log.message}
            </div>
        `).join('');
    }

    clearLogs() {
        this.logs = [];
        this.renderLogs();
    }

    showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer');
        const toastId = 'toast_' + Date.now();
        
        const toast = document.createElement('div');
        toast.id = toastId;
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <div class="toast-content">
                <span>${message}</span>
                <button class="toast-close" onclick="steamBooster.hideToast('${toastId}')">&times;</button>
            </div>
        `;
        
        container.appendChild(toast);
        
        // Trigger animation
        setTimeout(() => toast.classList.add('show'), 100);
        
        // Auto-hide after 5 seconds
        setTimeout(() => this.hideToast(toastId), 5000);
    }

    hideToast(toastId) {
        const toast = document.getElementById(toastId);
        if (toast) {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }
    }
}

// Initialize the application
const steamBooster = new SteamHourBooster();

// Make steamBooster globally available for onclick handlers
window.steamBooster = steamBooster;
