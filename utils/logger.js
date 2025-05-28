const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '..', 'logs');

// Define log format
const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ level, message, timestamp, stack, ...meta }) => {
        let log = `${timestamp} [${level.toUpperCase()}]: ${message}`;
        
        // Add metadata if present
        if (Object.keys(meta).length > 0) {
            log += ` | ${JSON.stringify(meta)}`;
        }
        
        // Add stack trace for errors
        if (stack) {
            log += `\n${stack}`;
        }
        
        return log;
    })
);

// Configure daily rotate file transport for general logs
const dailyRotateFileTransport = new DailyRotateFile({
    filename: path.join(logsDir, 'app-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '14d',
    format: logFormat
});

// Configure daily rotate file transport for error logs
const errorRotateFileTransport = new DailyRotateFile({
    filename: path.join(logsDir, 'error-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '30d',
    level: 'error',
    format: logFormat
});

// Configure daily rotate file transport for Steam-specific logs
const steamRotateFileTransport = new DailyRotateFile({
    filename: path.join(logsDir, 'steam-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '14d',
    format: logFormat
});

// Create the main logger
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: logFormat,
    transports: [
        dailyRotateFileTransport,
        errorRotateFileTransport
    ]
});

// Add console transport for development
if (true) {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
        )
    }));
}

// Create specialized loggers
const steamLogger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: logFormat,
    transports: [
        steamRotateFileTransport,
        dailyRotateFileTransport
    ]
});

// Create database logger
const dbLogger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: logFormat,
    transports: [
        new DailyRotateFile({
            filename: path.join(logsDir, 'database-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            zippedArchive: true,
            maxSize: '20m',
            maxFiles: '14d',
            format: logFormat
        }),
        dailyRotateFileTransport
    ]
});

// Add console for development
if (process.env.NODE_ENV !== 'production') {
    steamLogger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
        )
    }));
    
    dbLogger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
        )
    }));
}

// Helper functions for logging with context
const createContextLogger = (context) => {
    return {
        info: (message, meta = {}) => logger.info(message, { context, ...meta }),
        warn: (message, meta = {}) => logger.warn(message, { context, ...meta }),
        error: (message, meta = {}) => logger.error(message, { context, ...meta }),
        debug: (message, meta = {}) => logger.debug(message, { context, ...meta })
    };
};

// Steam-specific logging functions
const steamLog = {
    info: (message, meta = {}) => steamLogger.info(message, meta),
    warn: (message, meta = {}) => steamLogger.warn(message, meta),
    error: (message, meta = {}) => steamLogger.error(message, meta),
    debug: (message, meta = {}) => steamLogger.debug(message, meta),
    
    // Account-specific logging
    account: (accountId, message, meta = {}) => {
        steamLogger.info(message, { accountId, ...meta });
    },
    
    // Session-specific logging
    session: (sessionId, message, meta = {}) => {
        steamLogger.info(message, { sessionId, ...meta });
    },
    
    // Game boosting specific logging
    boosting: (accountId, gameId, message, meta = {}) => {
        steamLogger.info(message, { accountId, gameId, ...meta });
    }
};

// Database-specific logging
const dbLog = {
    info: (message, meta = {}) => dbLogger.info(message, meta),
    warn: (message, meta = {}) => dbLogger.warn(message, meta),
    error: (message, meta = {}) => dbLogger.error(message, meta),
    debug: (message, meta = {}) => dbLogger.debug(message, meta),
    
    query: (query, params, duration, meta = {}) => {
        dbLogger.debug('Database query executed', {
            query: query.substring(0, 200) + (query.length > 200 ? '...' : ''),
            params,
            duration: `${duration}ms`,
            ...meta
        });
    }
};

// Export loggers
module.exports = {
    logger,
    steamLog,
    dbLog,
    createContextLogger,
    
    // Convenience exports
    info: logger.info.bind(logger),
    warn: logger.warn.bind(logger),
    error: logger.error.bind(logger),
    debug: logger.debug.bind(logger)
};
