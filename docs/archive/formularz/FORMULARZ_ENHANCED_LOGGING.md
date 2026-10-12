# Formularz Enhanced Error Logging

## Problem

Still getting 500 errors when submitting presents via `/api/formularz/present`

## Solution

Added comprehensive logging to identify the exact cause of the error.

## Enhanced Logging Added

### 1. Recipient Lookup Logging
```javascript
console.log('[Formularz] Looking for recipient:', recipientName.trim());
```
- Logs when searching for existing recipient
- Shows the exact name being searched

### 2. Recipient Creation Logging
```javascript
console.log('[Formularz] Creating new recipient:', recipientName.trim());
```
- Logs when creating a new recipient
- Shows the name being created

### 3. Present Addition Logging
```javascript
console.log('[Formularz] Adding present:', { title, recipientId, comments });
```
- Logs before inserting present
- Shows all data being inserted

### 4. Cache Clearing Error Handling
```javascript
try {
    clearCombinedDataCache();
    cache.invalidatePresents();
    console.log('[Formularz] Cache cleared successfully');
} catch (cacheErr) {
    console.error('[Formularz] Cache clear error (non-fatal):', cacheErr);
    // Continue anyway - cache errors shouldn't fail the request
}
```
- Wraps cache clearing in try-catch
- Prevents cache errors from failing the entire request
- Logs cache errors separately

### 5. Detailed Error Logging
```javascript
console.error('[Formularz] Database error:', err);
console.error('[Formularz] Error stack:', err.stack);
console.error('[Formularz] Error details:', {
    message: err.message,
    code: err.code,
    errno: err.errno,
    sqlMessage: err.sqlMessage
});
```
- Logs full error object
- Logs stack trace
- Logs specific error details (SQL errors, error codes, etc.)

## What to Look For in Logs

### Successful Request:
```
[POST /api/formularz/present] Incoming request: { recipientName: 'John', presentTitle: 'Book' }
[Formularz] Looking for recipient: John
[Formularz] Using existing recipient: 5
[Formularz] Adding present: { title: 'Book', recipientId: 5, comments: null }
[Formularz] Present added successfully: 123
[Formularz] Cache cleared successfully
```

### New Recipient:
```
[POST /api/formularz/present] Incoming request: { recipientName: 'Jane', presentTitle: 'Toy' }
[Formularz] Looking for recipient: Jane
[Formularz] Creating new recipient: Jane
[Formularz] Created new recipient: 6
[Formularz] Adding present: { title: 'Toy', recipientId: 6, comments: 'Red toy' }
[Formularz] Present added successfully: 124
[Formularz] Cache cleared successfully
```

### Error Scenarios:

**Database Connection Error:**
```
[Formularz] Database error: Error: Connection lost
[Formularz] Error stack: [full stack trace]
[Formularz] Error details: { message: 'Connection lost', code: 'PROTOCOL_CONNECTION_LOST', ... }
```

**SQL Error:**
```
[Formularz] Database error: Error: ER_NO_SUCH_TABLE
[Formularz] Error details: { sqlMessage: "Table 'database.presents' doesn't exist", ... }
```

**Cache Error (non-fatal):**
```
[Formularz] Cache clear error (non-fatal): TypeError: cache.invalidatePresents is not a function
[Formularz] Present added successfully: 125
```

## Common Issues and Solutions

### 1. Database Connection Lost
**Log:** `Connection lost` or `PROTOCOL_CONNECTION_LOST`
**Solution:** 
- Check database server status
- Verify database credentials
- Check network connectivity

### 2. Table Doesn't Exist
**Log:** `ER_NO_SUCH_TABLE` or `Table doesn't exist`
**Solution:**
- Run database migrations
- Check table names
- Verify database schema

### 3. Column Doesn't Exist
**Log:** `ER_BAD_FIELD_ERROR` or `Unknown column`
**Solution:**
- Check column names in SQL query
- Verify database schema matches code

### 4. Duplicate Entry
**Log:** `ER_DUP_ENTRY` or `Duplicate entry`
**Solution:**
- Check unique constraints
- Handle duplicates in code

### 5. Cache Function Not Defined
**Log:** `cache.invalidatePresents is not a function`
**Solution:**
- Verify cache object has the method
- Check cache object definition

### 6. clearCombinedDataCache Not Defined
**Log:** `clearCombinedDataCache is not defined`
**Solution:**
- Verify function is defined
- Check function hoisting
- Move function definition earlier

## Next Steps

1. **Restart the server** to apply the new logging
2. **Try submitting a present** through the form
3. **Check server logs** for detailed error information
4. **Identify the exact error** from the logs
5. **Apply specific fix** based on the error

## Server Restart

**On Render:**
- Changes should auto-deploy
- Check deployment logs
- Wait for deployment to complete

**Locally:**
- Stop server (Ctrl+C)
- Start server (`npm start`)
- Test the endpoint

## Testing

**Test with curl:**
```bash
curl -X POST https://prezenty.matmamon.com/api/formularz/present \
  -H "Content-Type: application/json" \
  -d '{"recipientName":"Test User","presentTitle":"Test Present","presentComments":"Test comment"}'
```

**Expected response:**
```json
{
  "success": true,
  "presentId": 123
}
```

**Error response:**
```json
{
  "error": "Błąd podczas dodawania prezentu"
}
```

## Files Modified

1. `server.js` - Added comprehensive logging to `/api/formularz/present` endpoint

## Benefits

- **Detailed error tracking** - Know exactly where errors occur
- **Non-fatal cache errors** - Cache issues won't break the request
- **Better debugging** - Full error details in logs
- **Production-ready** - Proper error handling and logging

## Conclusion

The enhanced logging will help identify the exact cause of the 500 error. Once the server is restarted and a request is made, the logs will show:
- Exactly which step is failing
- The specific error message
- Full error details including SQL errors
- Whether it's a database, cache, or other issue

Check the server logs after the next request to see the detailed error information.
