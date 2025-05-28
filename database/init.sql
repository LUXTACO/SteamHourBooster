-- Steam Hour Booster Database Schema

-- Create accounts table to store multiple Steam accounts
CREATE TABLE IF NOT EXISTS accounts (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) NOT NULL,
    password VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    two_factor_secret VARCHAR(255),
    display_name VARCHAR(255),
    status VARCHAR(50) DEFAULT 'inactive',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP,
    is_active BOOLEAN DEFAULT true
);

-- Create partial unique index for usernames of active accounts only
CREATE UNIQUE INDEX IF NOT EXISTS idx_active_accounts_username 
ON accounts(username) 
WHERE is_active = true;

-- Create sessions table to track active login sessions
CREATE TABLE IF NOT EXISTS sessions (
    id SERIAL PRIMARY KEY,
    account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
    session_id VARCHAR(255) NOT NULL UNIQUE,
    steam_id VARCHAR(255),
    status VARCHAR(50) DEFAULT 'connected',
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP,
    last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create games table to store game information
CREATE TABLE IF NOT EXISTS games (
    id SERIAL PRIMARY KEY,
    app_id INTEGER NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    icon_url VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create boosting_sessions table to track game boosting
CREATE TABLE IF NOT EXISTS boosting_sessions (
    id SERIAL PRIMARY KEY,
    account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
    session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
    app_id INTEGER REFERENCES games(app_id),
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP,
    duration_seconds INTEGER DEFAULT 0,
    status VARCHAR(50) DEFAULT 'active'
);

-- Create logs table for application logging
CREATE TABLE IF NOT EXISTS logs (
    id SERIAL PRIMARY KEY,
    level VARCHAR(20) NOT NULL,
    message TEXT NOT NULL,
    metadata JSONB,
    account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_accounts_username ON accounts(username);
CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status);
CREATE INDEX IF NOT EXISTS idx_sessions_account_id ON sessions(account_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_boosting_sessions_account_id ON boosting_sessions(account_id);
CREATE INDEX IF NOT EXISTS idx_boosting_sessions_status ON boosting_sessions(status);
CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level);
CREATE INDEX IF NOT EXISTS idx_logs_account_id ON logs(account_id);

-- Create a function to update the updated_at column
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers to automatically update updated_at
CREATE TRIGGER update_accounts_updated_at BEFORE UPDATE ON accounts 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert some sample data (optional)
INSERT INTO games (app_id, name) VALUES 
(730, 'Counter-Strike 2'),
(440, 'Team Fortress 2'),
(570, 'Dota 2'),
(1085660, 'Destiny 2'),
(271590, 'Grand Theft Auto V')
ON CONFLICT (app_id) DO NOTHING;

-- Create a view for active boosting sessions with account info
CREATE OR REPLACE VIEW active_boosting_view AS
SELECT 
    bs.id,
    bs.account_id,
    a.username,
    a.display_name,
    bs.app_id,
    g.name as game_name,
    bs.started_at,
    EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - bs.started_at))::INTEGER as current_duration_seconds,
    bs.status
FROM boosting_sessions bs
JOIN accounts a ON bs.account_id = a.id
LEFT JOIN games g ON bs.app_id = g.app_id
WHERE bs.status = 'active' AND bs.ended_at IS NULL;

-- Create a view for session statistics
CREATE OR REPLACE VIEW session_stats_view AS
SELECT 
    a.id as account_id,
    a.username,
    COUNT(DISTINCT s.id) as total_sessions,
    COUNT(DISTINCT bs.id) as total_boosting_sessions,
    COALESCE(SUM(bs.duration_seconds), 0) as total_hours_boosted,
    MAX(s.last_activity) as last_activity
FROM accounts a
LEFT JOIN sessions s ON a.id = s.account_id
LEFT JOIN boosting_sessions bs ON a.id = bs.account_id AND bs.ended_at IS NOT NULL
GROUP BY a.id, a.username;
