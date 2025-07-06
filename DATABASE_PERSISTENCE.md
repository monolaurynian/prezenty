# Database Persistence Setup

This document explains how to set up the Prezenty app to maintain database data across deployments.

## Overview

The app uses SQLite for data storage. By default, SQLite databases are stored locally and get reset when the application is redeployed. This guide provides several solutions to maintain data persistence.

## Solution 1: Environment Variables (Recommended)

The app is configured to use environment variables for database paths:

- `DATABASE_PATH`: Path to the main database file
- `BACKUP_PATH`: Path to the backup database file

### For Local Development

Create a `.env` file in the root directory:

```env
DATABASE_PATH=./prezenty.db
BACKUP_PATH=./prezenty-backup.db
NODE_ENV=development
SESSION_SECRET=your-secret-key
```

### For Production Deployments

The deployment configurations (vercel.json, railway.json, render.yaml) are already set up with:

```env
DATABASE_PATH=/tmp/prezenty.db
BACKUP_PATH=/tmp/prezenty-backup.db
```

## Solution 2: Database Backup/Restore System

The app includes a backup/restore system that automatically handles database persistence:

### Available Scripts

```bash
# Backup the current database
npm run db:backup

# Restore database from backup
npm run db:restore

# Start app with automatic restore
npm run db:setup
```

### How It Works

1. **Backup**: Creates a copy of the database in a persistent location
2. **Restore**: Restores the database from backup if available
3. **Setup**: Automatically restores and starts the application

## Solution 3: Platform-Specific Setup

### Vercel

- Uses `/tmp` directory for persistent storage
- Database persists between function invocations
- Configured in `vercel.json`

### Railway

- Uses `/tmp` directory for persistent storage
- Database persists between deployments
- Configured in `railway.json`

### Render

- Uses `/tmp` directory for persistent storage
- Database persists between deployments
- Configured in `render.yaml`

## Solution 4: Manual Database Management

### Creating a Backup

```bash
# Create a backup of your current database
cp prezenty.db prezenty-backup.db
```

### Restoring from Backup

```bash
# Restore from backup
cp prezenty-backup.db prezenty.db
```

## Solution 5: External Database (Advanced)

For production applications, consider migrating to an external database:

### PostgreSQL (Recommended)

1. Set up a PostgreSQL database (e.g., on Railway, Render, or AWS)
2. Update the app to use PostgreSQL instead of SQLite
3. Configure connection string via environment variables

### MongoDB

1. Set up a MongoDB database
2. Update the app to use MongoDB
3. Configure connection string via environment variables

## Troubleshooting

### Database Not Persisting

1. Check environment variables are set correctly
2. Verify the backup/restore system is working
3. Check file permissions on the database directory
4. Ensure the deployment platform supports persistent storage

### Backup/Restore Issues

1. Check if the backup file exists
2. Verify file permissions
3. Check available disk space
4. Review application logs for errors

### Platform-Specific Issues

#### Vercel
- `/tmp` directory is ephemeral in serverless functions
- Consider using Vercel KV or external database

#### Railway
- `/tmp` directory should persist between deployments
- Check Railway logs for any errors

#### Render
- `/tmp` directory should persist between deployments
- Check Render logs for any errors

## Best Practices

1. **Regular Backups**: Set up automated backups
2. **Test Restores**: Regularly test the restore process
3. **Monitor Storage**: Keep track of database size
4. **Environment Variables**: Use environment variables for configuration
5. **Logging**: Monitor application logs for database issues

## Migration Guide

### From Local SQLite to Persistent Storage

1. Backup your current database:
   ```bash
   npm run db:backup
   ```

2. Deploy with the new configuration

3. The app will automatically restore your data

### From SQLite to External Database

1. Set up external database (PostgreSQL/MongoDB)
2. Create migration scripts
3. Update application code
4. Test thoroughly before deploying

## Support

If you encounter issues with database persistence:

1. Check the application logs
2. Verify environment variables
3. Test the backup/restore system locally
4. Consider migrating to an external database for production use 