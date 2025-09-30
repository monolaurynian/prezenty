# Database Setup Guide

## Current Status

✅ **Database Host**: Reachable at `153.92.7.101`
✅ **Database Name**: `u662139794_prezenty` 
✅ **Username**: `u662139794_mati`
❌ **Password**: Not set or inc  orrect

## Issue Identified

The database connection test shows:
```
❌ Database connection failed: Access denied for user 'u662139794_mati'@'44.226.122.3' (using password: YES)
Error code: ER_ACCESS_DENIED_ERROR
```

This means:
1. The database server is reachable
2. The username and password are correct
3. The user doesn't have access from the Render server IP address (`44.226.122.3`)

## IP Address Access Issue

The connection is being attempted from different IP addresses:
- **Local development**: `80.233.53.170` (your local IP)
- **Render deployment**: `44.226.122.3` (Render server IP)

The database user needs access from both IPs.

## Required Actions

### 1. Set the Database Password

Update the `.env` file with the correct password:
```env
DB_PASSWORD=your_actual_database_password
```

### 2. Fix IP Address Access

The database user `u662139794_mati` needs access from multiple IP addresses:

**For Local Development:**
- Your local IP: `80.233.53.170`

**For Render Deployment:**
- Render server IP: `44.226.122.3`
- Or better: Allow access from any IP (`%`) if your hosting provider supports it

**Database Permissions Needed:**
- `SELECT`, `INSERT`, `UPDATE`, `DELETE` permissions on the database
- `CREATE`, `ALTER`, `DROP` permissions for schema initialization

### 3. Contact Your Database Host Provider

You need to:
1. **Whitelist Render's IP address** `44.226.122.3` in your database access control
2. **Or enable access from any IP** (less secure but easier for deployment)
3. **Verify the user has proper permissions** for the database operations

### 4. Test the Connection

Run the database connection test:
```bash
node test-db.js
```

### 5. For Render Deployment

Set the `DB_PASSWORD` environment variable in your Render dashboard:
1. Go to your service settings
2. Navigate to Environment Variables
3. Set `DB_PASSWORD` to your actual database password

## Database Schema

The app will automatically create these tables on first run:
- `users` - User authentication
- `recipients` - Gift recipients with profile pictures (BLOB storage)
- `presents` - Gift ideas and reservations  
- `sessions` - Express session storage

## Connection Configuration

Current settings:
- **Host**: 153.92.7.101
- **Port**: 3306
- **Database**: u662139794_prezenty
- **User**: u662139794_mati
- **Charset**: utf8mb4
- **Connection Timeout**: 60 seconds

## Troubleshooting

If you continue to have issues:

1. **Check with your hosting provider** that the user has proper permissions
2. **Verify IP whitelist** includes both:
   - Your local IP: `80.233.53.170` 
   - Render server IP: `44.226.122.3`
   - Or allow access from any IP (`%` or `0.0.0.0/0`)
3. **Test from command line**:
   ```bash
   mysql -h 153.92.7.101 -u u662139794_mati -p u662139794_prezenty
   ```

## Common Solutions

### Option 1: Whitelist Specific IPs
Add these IPs to your database access control:
- `80.233.53.170` (your local development)
- `44.226.122.3` (Render deployment)

### Option 2: Allow All IPs (Less Secure)
Configure your database to allow connections from any IP address (`%` or `0.0.0.0/0`)

### Option 3: Use Database Connection String
Some hosting providers prefer connection strings. You can set:
```env
DATABASE_URL=mysql://u662139794_mati:your_password@153.92.7.101:3306/u662139794_prezenty
```

## Next Steps

Once the password is set correctly:
1. Run `npm run test-db` to verify connection
2. Run `npm run init-db` to create database tables (if needed)
3. Run `npm start` to start the application

## Database Initialization

The server no longer automatically creates database tables on startup. This prevents issues during deployment.

**To create tables manually:**
```bash
npm run init-db
```

**To test database connection:**
```bash
npm run test-db
```