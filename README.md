# Steam Hour Booster - Multi Account Edition

A modern, Docker-based Steam hour booster with support for multiple accounts, PostgreSQL database, and comprehensive logging.

## Features

### Core Features

- 🔥 **Multi-Account Support**: Manage and boost hours on multiple Steam accounts simultaneously
- 🐘 **PostgreSQL Database**: Persistent storage for accounts, sessions, and statistics
- 📊 **Real-time Monitoring**: Live dashboard showing account status and boosting progress
- 🔒 **Steam Guard Support**: Automatic handling of Steam Guard authentication
- 📝 **Comprehensive Logging**: Volume-based logging with rotation and different log levels
- 🌐 **Modern Web Interface**: Clean, responsive UI for easy management

### New Features

- **Multiple Account Management**: Add, edit, and delete Steam accounts
- **Session Tracking**: Monitor active sessions and uptime for each account
- **Game Selection Interface**: Easy selection of games to boost with popular presets
- **Real-time Statistics**: Track total boosting time and session history
- **Database Persistence**: All data persists across container restarts
- **Volume-based Logging**: Logs stored in Docker volumes, not container storage

## Quick Start

### Prerequisites

- Docker
- Docker Compose

### Installation

1. **Clone the repository**

```bash
git clone <repository-url>
cd HourBoost
```

2. **Start the application**

```bash
docker-compose up -d
```

3. **Access the web interface**
Open your browser and navigate to `http://localhost:3000`

### Database Setup

The PostgreSQL database is automatically initialized with:

- Account management tables
- Session tracking
- Boosting history
- Application logs
- Pre-populated popular games

## Usage

### Adding Accounts

1. Navigate to the web interface at `http://localhost:3000`
2. Fill in the "Add New Account" form:
   - **Steam Username**: Your Steam login username
   - **Steam Password**: Your Steam password
   - **Email** (optional): For easier identification
   - **Display Name** (optional): Friendly name for the account
   - **2FA Secret** (optional): For automated Steam Guard (if supported)

### Managing Accounts

Each account shows:

- **Status**: Current connection state (Online, Offline, Connecting, etc.)
- **Games Being Boosted**: List of currently active games
- **Action Buttons**: Login, Logout, Start/Stop Boosting, Delete

### Starting Hour Boosting

1. **Login Account**: Click the "Login" button for any account
2. **Handle Steam Guard**: Enter Steam Guard code if prompted
3. **Select Games**: Click "Start Boosting" and select games:
   - Enter Steam App IDs manually
   - Use popular game buttons for quick selection
4. **Monitor Progress**: Watch real-time status in the dashboard

### Popular Game IDs

The interface includes quick buttons for popular games:

- **Counter-Strike 2**: 730
- **Team Fortress 2**: 440
- **Dota 2**: 570
- **Destiny 2**: 1085660
- **Grand Theft Auto V**: 271590

## Configuration

### Environment Variables

The application supports these environment variables:

```env
# Database Configuration
DB_HOST=postgres
DB_PORT=5432
DB_NAME=steam_booster
DB_USER=steam_user
DB_PASSWORD=steam_password

# Application Configuration
NODE_ENV=production
PORT=3000
LOG_LEVEL=info
```

### Docker Compose Configuration

The `docker-compose.yml` includes:

- **PostgreSQL Database**: Persistent storage with health checks
- **Application Server**: Node.js with multi-account support
- **Named Volumes**: For database and logs persistence
- **Health Checks**: Automated service monitoring

## API Endpoints

The application provides a REST API for programmatic access:

### Accounts

- `GET /api/accounts` - List all accounts
- `POST /api/accounts` - Create new account
- `GET /api/accounts/:id` - Get account details
- `PUT /api/accounts/:id` - Update account
- `DELETE /api/accounts/:id` - Delete account

### Status

- `GET /api/status` - Get current system status
- `GET /api/accounts/:id/stats` - Get account statistics

## Logging

### Log Types

- **Application Logs**: General application events
- **Steam Logs**: Steam-specific events and errors
- **Database Logs**: Database queries and operations

### Log Storage

Logs are stored in Docker volumes with automatic rotation:

- **Location**: `/app/logs` (inside container)
- **Rotation**: Daily with compression
- **Retention**: 14 days (30 days for errors)
- **Format**: Timestamped JSON with metadata

### Log Files

- `app-YYYY-MM-DD.log` - General application logs
- `steam-YYYY-MM-DD.log` - Steam-specific logs
- `database-YYYY-MM-DD.log` - Database operation logs
- `error-YYYY-MM-DD.log` - Error logs only

## Database Schema

### Tables

- **accounts**: Steam account credentials and metadata
- **sessions**: Active login sessions tracking
- **games**: Game information and metadata
- **boosting_sessions**: Individual game boosting records
- **logs**: Application log entries

### Views

- **active_boosting_view**: Current active boosting sessions
- **session_stats_view**: Aggregated session statistics

## Security Considerations

⚠️ **Important Security Notes:**

1. **Credential Storage**: Steam passwords are stored in the database. Consider encryption for production use.
2. **Network Security**: The application runs on port 3000 by default. Use a reverse proxy for HTTPS.
3. **Database Access**: PostgreSQL is exposed on port 5432. Restrict access in production.
4. **Steam Guard**: Manual Steam Guard codes required for each login (automated 2FA not fully implemented).

## Troubleshooting

### Common Issues

**Database Connection Failed**

```bash
# Check if PostgreSQL is running
docker-compose ps postgres

# Check logs
docker-compose logs postgres
```

**Steam Login Issues**

- Verify Steam credentials are correct
- Check if Steam Guard is enabled
- Monitor logs for specific error messages

**Port Already in Use**

```bash
# Change port in docker-compose.yml
ports:
  - "3001:3000"  # Use port 3001 instead
```

### Log Analysis

View real-time logs:

```bash
# Application logs
docker-compose logs -f steam-hour-booster

# Database logs
docker-compose logs -f postgres

# All logs
docker-compose logs -f
```

## Development

### Local Development

1. **Install dependencies**

```bash
npm install
```

2. **Start PostgreSQL**

```bash
docker-compose up -d postgres
```

3. **Set environment variables**

```bash
export DB_HOST=localhost
export DB_PORT=5432
export DB_NAME=steam_booster
export DB_USER=steam_user
export DB_PASSWORD=steam_password
```

4. **Start development server**

```bash
npm run dev
```

### File Structure

```
HourBoost/
├── database/
│   ├── connection.js      # Database connection manager
│   └── init.sql          # Database schema and initial data
├── managers/
│   └── SteamManager.js   # Steam client management
├── models/
│   └── Account.js        # Account data model
├── public/
│   ├── index.html        # Web interface
│   ├── style.css         # Styling
│   └── script.js         # Frontend JavaScript
├── utils/
│   └── logger.js         # Logging utilities
├── docker-compose.yml    # Docker services configuration
├── Dockerfile           # Application container
├── package.json         # Node.js dependencies
└── server.js           # Main application server
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the MIT License. See the LICENSE file for details.

## Disclaimer

This tool is for educational purposes only. Use responsibly and in accordance with Steam's Terms of Service. The developers are not responsible for any account restrictions or bans that may result from using this software.

---

**Version**: 2.0.0  
**Last Updated**: 2025-05-27  
**Node.js**: 18+  
**Docker**: 20.10+
