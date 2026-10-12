# Formularz Feature Documentation

## Overview
The Formularz page allows users to add their gift wishes without requiring authentication. It also provides an authenticated section where users can edit their own presents.

## Features

### 1. Add Present (No Authentication Required)
- Users can add presents by providing:
  - Their name (recipient name)
  - Present title
  - Optional comments/description
- The system automatically creates or finds the recipient
- Presents are added to the database and visible to all users

### 2. Edit My Presents (Authentication Required)
- Users must log in or register to access this section
- Shows all presents associated with the user's identified recipient
- Allows editing and deleting their own presents
- Protected by authentication modal

## Access
- URL: `/formularz`
- Available from the main navigation or directly via URL

## Technical Implementation

### Frontend Files
- `public/formularz.html` - Main page with two tabs
- `public/formularz.js` - JavaScript functionality

### Backend Endpoints
- `POST /api/formularz/present` - Submit present (no auth)
- `GET /api/formularz/my-presents` - Get user's presents (requires auth)
- `PUT /api/presents/:id` - Edit present (requires auth)
- `DELETE /api/presents/:id` - Delete present (requires auth)

### Database
- Uses existing `recipients` and `presents` tables
- Anonymous submissions have `created_by = NULL`
- Authenticated users link to their identified recipient

## User Flow

### Adding a Present (Anonymous)
1. User visits `/formularz`
2. Fills out the form with their name and present details
3. Submits the form
4. Present is added to the database
5. Success message is displayed

### Editing Presents (Authenticated)
1. User clicks "Edytuj Moje Prezenty" tab
2. If not authenticated, modal appears with login/register options
3. User logs in or registers
4. System loads presents for their identified recipient
5. User can edit or delete their presents

## Styling
- Uses the same Christmas theme as login/register pages
- Snowflake animations in the form card
- Similar styling to recipients page for consistency
- Responsive design for mobile and desktop

## Security
- Anonymous submissions are allowed for adding presents
- Editing/deleting requires authentication
- Users can only edit presents associated with their identified recipient
- Session-based authentication using existing system
