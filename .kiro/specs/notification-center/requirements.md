# Requirements Document

## Introduction

Replace the test notification button with a comprehensive notification center that displays recent activity in the app. Users will see a bell icon with a badge count in the top right corner, which opens a dropdown showing recent actions. The system must respect privacy by hiding information about presents for identified recipients.

## Requirements

### Requirement 1: Notification Bell UI

**User Story:** As a user, I want to see a notification bell icon with a badge count in the top right corner, so that I know when there are new activities in the app.

#### Acceptance Criteria

1. WHEN the page loads THEN a bell icon SHALL be displayed in the top right corner of the navigation
2. WHEN there are unread notifications THEN a badge with the count SHALL be displayed on the bell icon
3. WHEN the badge count is 0 THEN the badge SHALL be hidden
4. WHEN the badge count exceeds 99 THEN it SHALL display "99+"
5. WHEN a user clicks the bell icon THEN a dropdown SHALL open showing recent notifications

### Requirement 2: Notification Dropdown

**User Story:** As a user, I want to see a dropdown with recent activities when I click the bell icon, so that I can quickly see what's happening in the app.

#### Acceptance Criteria

1. WHEN the dropdown opens THEN it SHALL display the 5 most recent notifications
2. WHEN a notification is displayed THEN it SHALL show the action type, actor, timestamp, and relevant details
3. WHEN a notification is unread THEN it SHALL have a visual indicator (e.g., background color, bold text)
4. WHEN a user clicks on a notification THEN it SHALL be marked as read
5. WHEN the dropdown is open THEN clicking outside SHALL close it
6. WHEN there are no notifications THEN the dropdown SHALL show "Brak powiadomień"
7. WHEN there are more than 5 notifications THEN a "Zobacz więcej" link SHALL be displayed at the bottom

### Requirement 3: Activity Feed Page

**User Story:** As a user, I want to view all my notifications in a dedicated page, so that I can review the complete history of activities.

#### Acceptance Criteria

1. WHEN a user clicks "Zobacz więcej" THEN they SHALL be redirected to the activity feed page
2. WHEN the activity feed page loads THEN it SHALL display all notifications in chronological order (newest first)
3. WHEN the page loads THEN it SHALL show 20 notifications per page
4. WHEN there are more than 20 notifications THEN pagination or infinite scroll SHALL be available
5. WHEN a notification is clicked THEN it SHALL be marked as read
6. WHEN all notifications are read THEN the bell badge count SHALL update to 0

### Requirement 4: Privacy for Identified Recipients

**User Story:** As an identified recipient, I want my present-related information to be hidden from my view, so that I don't spoil the surprise.

#### Acceptance Criteria

1. WHEN a user is identified as a recipient THEN notifications about presents for that recipient SHALL be hidden
2. WHEN a present is added for the identified recipient THEN no notification SHALL be shown to that user
3. WHEN a present is reserved for the identified recipient THEN no notification SHALL be shown to that user
4. WHEN a present is checked for the identified recipient THEN no notification SHALL be shown to that user
5. WHEN a user is not identified THEN all notifications SHALL be visible

### Requirement 5: Notification Types

**User Story:** As a user, I want to see different types of notifications for different actions, so that I understand what happened in the app.

#### Acceptance Criteria

1. WHEN a recipient is added THEN a notification SHALL be created with type "recipient_added"
2. WHEN a present is added THEN a notification SHALL be created with type "present_added"
3. WHEN a present is reserved THEN a notification SHALL be created with type "present_reserved"
4. WHEN a present reservation is cancelled THEN a notification SHALL be created with type "present_unreserved"
5. WHEN a present is checked THEN a notification SHALL be created with type "present_checked"
6. WHEN a present is unchecked THEN a notification SHALL be created with type "present_unchecked"
7. WHEN each notification type is displayed THEN it SHALL have an appropriate icon and color

### Requirement 6: Real-time Updates

**User Story:** As a user, I want the notification count to update in real-time, so that I always see the current state without refreshing.

#### Acceptance Criteria

1. WHEN a new notification is created THEN the bell badge count SHALL increment
2. WHEN a notification is marked as read THEN the bell badge count SHALL decrement
3. WHEN the dropdown is open and a new notification arrives THEN it SHALL appear in the list
4. WHEN the activity feed is open and a new notification arrives THEN it SHALL appear at the top of the list
