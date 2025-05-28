const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

// Import our modules
const db = require('./database/connection');
const { logger, steamLog } = require('./utils/logger');
const Account = require('./models/Account');
const SteamManager = require('./managers/SteamManager');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: ["*"],
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize Steam Manager
const steamManager = new SteamManager();

// Initialize database connection
async function initializeDatabase() {
  try {
    await db.connect();
    logger.info('Database connection established');
  } catch (error) {
    logger.error('Failed to connect to database:', error);
    process.exit(1);
  }
}

// API Routes

// Get all accounts
app.get('/api/accounts', async (req, res) => {
  try {
    const accounts = await Account.getAll();
    res.json(accounts.map(account => account.toJSON()));
  } catch (error) {
    logger.error('Failed to get accounts:', error);
    res.status(500).json({ error: 'Failed to retrieve accounts' });
  }
});

// Create new account
app.post('/api/accounts', async (req, res) => {
  try {
    const { username, password, email, twoFactorSecret, displayName } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    // Check if account already exists
    const existingAccount = await Account.findByUsername(username);
    if (existingAccount) {
      return res.status(409).json({ error: 'Account already exists' });
    }

    const account = await Account.create({
      username,
      password,
      email,
      twoFactorSecret,
      displayName: displayName || username
    });

    logger.info('New account created', { accountId: account.id, username });
    res.status(201).json(account.toJSON());
  } catch (error) {
    logger.error('Failed to create account:', error);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

// Get account by ID
app.get('/api/accounts/:id', async (req, res) => {
  try {
    const account = await Account.findById(req.params.id);
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }
    res.json(account.toJSON());
  } catch (error) {
    logger.error('Failed to get account:', error);
    res.status(500).json({ error: 'Failed to retrieve account' });
  }
});

// Update account
app.put('/api/accounts/:id', async (req, res) => {
  try {
    const account = await Account.findById(req.params.id);
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const { password, email, twoFactorSecret, displayName } = req.body;
    await account.update({ password, email, twoFactorSecret, displayName });

    logger.info('Account updated', { accountId: account.id, username: account.username });
    res.json(account.toJSON());
  } catch (error) {
    logger.error('Failed to update account:', error);
    res.status(500).json({ error: 'Failed to update account' });
  }
});

// Delete account
app.delete('/api/accounts/:id', async (req, res) => {
  try {
    const account = await Account.findById(req.params.id);
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    // Disconnect if logged in
    await steamManager.disconnectAccount(account.id);
    
    await account.delete();
    logger.info('Account deleted', { accountId: account.id, username: account.username });
    res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    logger.error('Failed to delete account:', error);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

// Get active sessions status
app.get('/api/status', (req, res) => {
  try {
    const activeAccounts = steamManager.getActiveAccounts();
    res.json({
      activeAccounts,
      totalActive: activeAccounts.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to get status:', error);
    res.status(500).json({ error: 'Failed to retrieve status' });
  }
});

// Get account statistics
app.get('/api/accounts/:id/stats', async (req, res) => {
  try {
    const account = await Account.findById(req.params.id);
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const stats = await account.getStatistics();
    res.json(stats);
  } catch (error) {
    logger.error('Failed to get account statistics:', error);
    res.status(500).json({ error: 'Failed to retrieve statistics' });
  }
});

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Socket.io connection handling
io.on('connection', (socket) => {
  logger.info('Client connected', { socketId: socket.id });
  
  // Send current status to newly connected client
  socket.emit('status', {
    activeAccounts: steamManager.getActiveAccounts(),
    timestamp: new Date().toISOString()
  });

  // Handle account login
  socket.on('loginAccount', async (data) => {
    try {
      const { accountId, twoFactorCode } = data;
      
      const account = await Account.findById(accountId);
      if (!account) {
        socket.emit('loginError', { 
          accountId, 
          error: 'Account not found' 
        });
        return;
      }

      const credentials = {
        username: account.username,
        password: account.password,
        twoFactorCode
      };

      const sessionId = await steamManager.loginAccount(accountId, credentials, socket);
      await account.updateLastLogin();

      logger.info('Account login initiated', { 
        accountId, 
        username: account.username, 
        sessionId 
      });

    } catch (error) {
      logger.error('Login failed:', error);
      socket.emit('loginError', { 
        accountId: data.accountId, 
        error: error.message 
      });
    }
  });

  // Handle account logout
  socket.on('logoutAccount', async (data) => {
    try {
      const { accountId } = data;
      
      await steamManager.disconnectAccount(accountId);
      
      socket.emit('accountLoggedOut', { 
        accountId,
        message: 'Account logged out successfully' 
      });

      // Broadcast updated status
      io.emit('status', {
        activeAccounts: steamManager.getActiveAccounts(),
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Logout failed:', error);
      socket.emit('error', { 
        accountId: data.accountId, 
        error: error.message 
      });
    }
  });

  // Handle start boosting
  socket.on('startBoosting', async (data) => {
    try {
      const { accountId, gameIds } = data;
      
      if (!Array.isArray(gameIds) || gameIds.length === 0) {
        socket.emit('error', { 
          accountId, 
          error: 'No valid game IDs provided' 
        });
        return;
      }

      await steamManager.startBoosting(accountId, gameIds, socket);

      // Broadcast updated status
      io.emit('status', {
        activeAccounts: steamManager.getActiveAccounts(),
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Start boosting failed:', error);
      socket.emit('error', { 
        accountId: data.accountId, 
        error: error.message 
      });
    }
  });

  // Handle stop boosting
  socket.on('stopBoosting', async (data) => {
    try {
      const { accountId } = data;
      
      await steamManager.stopBoosting(accountId, socket);

      // Broadcast updated status
      io.emit('status', {
        activeAccounts: steamManager.getActiveAccounts(),
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Stop boosting failed:', error);
      socket.emit('error', { 
        accountId: data.accountId, 
        error: error.message 
      });
    }
  });

  // Handle Steam Guard code submission
  socket.on('submitSteamGuard', (data) => {
    const { accountId, code } = data;
    socket.emit(`steamGuardCode_${accountId}`, code);
  });

  // Handle get account status
  socket.on('getAccountStatus', (data) => {
    const { accountId } = data;
    const status = steamManager.getAccountStatus(accountId);
    socket.emit('accountStatus', { accountId, status });
  });

  // Handle get all accounts status
  socket.on('getAllStatus', () => {
    socket.emit('status', {
      activeAccounts: steamManager.getActiveAccounts(),
      timestamp: new Date().toISOString()
    });
  });

  socket.on('disconnect', () => {
    logger.info('Client disconnected', { socketId: socket.id });
  });
});

// Status update interval - broadcast status every 30 seconds
setInterval(() => {
  io.emit('statusUpdate', {
    activeAccounts: steamManager.getActiveAccounts(),
    timestamp: new Date().toISOString()
  });
}, 30000);

// Start server
const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    // Initialize database first
    await initializeDatabase();
    
    // Start HTTP server
    server.listen(PORT, () => {
      logger.info(`Steam Hour Booster server running on port ${PORT}`);
      logger.info(`Web interface: http://localhost:${PORT}`);
      logger.info(`API endpoints: http://localhost:${PORT}/api`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
const gracefulShutdown = async (signal) => {
  logger.info(`Received ${signal}, starting graceful shutdown...`);
  
  try {
    // Clean up Steam connections
    await steamManager.cleanup();
    
    // Close database connection
    await db.disconnect();
    
    // Close HTTP server
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
    
    // Force exit after 10 seconds
    setTimeout(() => {
      logger.warn('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
    
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
};

// Handle shutdown signals
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('unhandledRejection');
});

// Start the application
startServer();
