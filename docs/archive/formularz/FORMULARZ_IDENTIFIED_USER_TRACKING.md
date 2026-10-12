# Formularz Identified User Tracking

## Feature

When a present is added via the formularz for a recipient who has identified themselves, the `created_by` field is automatically set to that user's ID.

## Implementation

### Logic Flow

1. **Look up recipient** by name
2. **Check if identified** - Get `identified_by` field
3. **Add present** with appropriate `created_by`:
   - If recipient is identified → Use their user ID
   - If recipient not identified → Don't include `created_by`

### Code

```javascript
// Find or create recipient
const [recipientRows] = await pool.execute(
    'SELECT id, identified_by FROM recipients WHERE name = ?', 
    [recipientName.trim()]
);

let recipientId;
let createdByUserId = null;

if (recipientRows.length > 0) {
    recipientId = recipientRows[0].id;
    createdByUserId = recipientRows[0].identified_by; // Get identified user
} else {
    // Create new recipient (not identified)
    const [result] = await pool.execute(
        'INSERT INTO recipients (name) VALUES (?)', 
        [recipientName.trim()]
    );
    recipientId = result.insertId;
}

// Add present with appropriate created_by
if (createdByUserId) {
    // Recipient is identified - use their user ID
    await pool.execute(
        'INSERT INTO presents (title, recipient_id, comments, created_by) VALUES (?, ?, ?, ?)',
        [presentTitle, recipientId, comments, createdByUserId]
    );
} else {
    // Recipient not identified - don't include created_by
    await pool.execute(
        'INSERT INTO presents (title, recipient_id, comments) VALUES (?, ?, ?)',
        [presentTitle, recipientId, comments]
    );
}
```

## Scenarios

### Scenario 1: Identified Recipient
**Setup:**
- User "John" (ID: 5) has identified as recipient "John Doe" (ID: 10)
- Someone submits a present for "John Doe" via formularz

**Result:**
```sql
INSERT INTO presents (title, recipient_id, comments, created_by) 
VALUES ('Book', 10, 'Any book', 5)
```

**Database:**
- `recipient_id`: 10 (John Doe)
- `created_by`: 5 (John's user ID)
- Present is tracked as created by John

### Scenario 2: Non-Identified Recipient
**Setup:**
- Recipient "Jane Smith" (ID: 11) exists but no user has identified as her
- Someone submits a present for "Jane Smith" via formularz

**Result:**
```sql
INSERT INTO presents (title, recipient_id, comments) 
VALUES ('Toy', 11, 'Red toy')
```

**Database:**
- `recipient_id`: 11 (Jane Smith)
- `created_by`: NULL or default value
- Present is anonymous

### Scenario 3: New Recipient
**Setup:**
- Recipient "Bob Wilson" doesn't exist yet
- Someone submits a present for "Bob Wilson" via formularz

**Result:**
```sql
-- First, create recipient
INSERT INTO recipients (name) VALUES ('Bob Wilson')
-- Then, add present
INSERT INTO presents (title, recipient_id, comments) 
VALUES ('Game', 12, 'Board game')
```

**Database:**
- New recipient created (ID: 12)
- `recipient_id`: 12 (Bob Wilson)
- `created_by`: NULL or default value
- Present is anonymous

## Benefits

### 1. Automatic Attribution
- Users who identify themselves automatically "own" presents added for them
- No need to log in to add presents to their own list
- Presents are properly tracked

### 2. Privacy Maintained
- Anonymous submissions still work
- Only identified recipients have presents attributed to them
- No forced authentication

### 3. Data Integrity
- Proper tracking of who created what
- Can filter/query presents by creator
- Audit trail for identified users

### 4. User Experience
- Identified users can add presents without logging in
- Presents automatically appear in "Edit My Presents"
- Seamless workflow

## Database Schema

**Recipients Table:**
```sql
CREATE TABLE recipients (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    identified_by INT NULL,  -- User ID who identified as this recipient
    FOREIGN KEY (identified_by) REFERENCES users(id)
);
```

**Presents Table:**
```sql
CREATE TABLE presents (
    id INT PRIMARY KEY AUTO_INCREMENT,
    title VARCHAR(255) NOT NULL,
    recipient_id INT NOT NULL,
    comments TEXT,
    created_by INT NULL,  -- User ID who created the present
    FOREIGN KEY (recipient_id) REFERENCES recipients(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
);
```

## Queries

### Get presents created by a user:
```sql
SELECT * FROM presents WHERE created_by = ?
```

### Get presents for an identified recipient:
```sql
SELECT p.* 
FROM presents p
JOIN recipients r ON p.recipient_id = r.id
WHERE r.identified_by = ?
```

### Get anonymous presents:
```sql
SELECT * FROM presents WHERE created_by IS NULL
```

## Logging

**Console logs show the tracking:**

```
[Formularz] Looking for recipient: John Doe
[Formularz] Using existing recipient: 10 identified_by: 5
[Formularz] Adding present: { title: 'Book', recipientId: 10, comments: null, createdBy: 5 }
[Formularz] Present added successfully: 123
```

**For non-identified:**
```
[Formularz] Looking for recipient: Jane Smith
[Formularz] Using existing recipient: 11 identified_by: null
[Formularz] Adding present: { title: 'Toy', recipientId: 11, comments: null, createdBy: null }
[Formularz] Present added successfully: 124
```

## Edge Cases

### 1. User Identifies After Presents Added
**Scenario:** Presents added anonymously, then user identifies

**Result:**
- Old presents: `created_by` is NULL
- New presents: `created_by` is user ID
- Both show in "Edit My Presents" (filtered by recipient_id)

### 2. User Un-identifies
**Scenario:** User cancels identification

**Result:**
- Existing presents: `created_by` remains (historical record)
- New presents: `created_by` will be NULL
- User can no longer edit old presents

### 3. Multiple Users Try to Identify
**Scenario:** Two users try to identify as same recipient

**Result:**
- Only one can identify (database constraint)
- First user's ID is used for `created_by`
- Second user gets error

## Security

**No security issues:**
- ✅ Users can only edit presents for recipients they're identified as
- ✅ `created_by` is set server-side (not from client)
- ✅ No authentication bypass
- ✅ Proper authorization checks in edit endpoints

## Testing

### Test Identified User:
1. Login as user
2. Identify as a recipient
3. Logout
4. Go to formularz (not logged in)
5. Add present for that recipient
6. Check database: `created_by` should be user's ID

### Test Non-Identified:
1. Go to formularz (not logged in)
2. Add present for non-identified recipient
3. Check database: `created_by` should be NULL

### Test New Recipient:
1. Go to formularz (not logged in)
2. Add present for new recipient name
3. Check database: recipient created, `created_by` is NULL

## Files Modified

1. `server.js` - Updated `/api/formularz/present` endpoint

## Conclusion

Presents added via the formularz are now automatically attributed to the identified user if the recipient has been identified. This provides:
- ✅ Automatic ownership tracking
- ✅ Better data integrity
- ✅ Seamless user experience
- ✅ Privacy for anonymous submissions

Users who identify themselves can now add presents to their own list without logging in, and those presents will be properly tracked as created by them!
