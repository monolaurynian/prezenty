# Requirements Document

## Introduction

The push notification system is currently implemented but notifications are not being delivered to users. This feature aims to diagnose and fix the issues preventing push notifications from working properly when new presents are added to the system.

## Requirements

### Requirement 1: Notification Delivery

**User Story:** As a user who has enabled notifications, I want to receive push notifications when other users add new presents, so that I can stay updated on gift additions in real-time.

#### Acceptance Criteria

1. WHEN a user adds a new present THEN all other subscribed users SHALL receive a push notification
2. WHEN a push notification is sent THEN the notification SHALL include the present title and recipient name
3. IF a subscription is invalid (410 error) THEN the system SHALL remove it from the database
4. WHEN a user clicks on a notification THEN the app SHALL open or focus on the recipients page

### Requirement 2: Subscription Management

**User Story:** As a user, I want my notification subscription to be properly saved and maintained, so that I can reliably receive notifications.

#### Acceptance Criteria

1. WHEN a user grants notification permission THEN their subscription SHALL be saved to the database
2. WHEN a user's subscription already exists THEN it SHALL be updated with new keys if changed
3. IF the web-push module is not available THEN the system SHALL provide clear error messages
4. WHEN a user subscribes THEN they SHALL receive a test notification confirming the subscription

### Requirement 3: Error Handling and Debugging

**User Story:** As a developer, I want comprehensive logging and error handling for the notification system, so that I can quickly diagnose and fix issues.

#### Acceptance Criteria

1. WHEN a notification fails to send THEN the error SHALL be logged with details
2. WHEN the sendNotificationToUsers function is called THEN it SHALL log the number of subscriptions found
3. IF no subscriptions exist THEN the system SHALL log this information
4. WHEN a notification is successfully sent THEN the system SHALL log confirmation for each recipient

### Requirement 4: VAPID Configuration

**User Story:** As a system administrator, I want VAPID keys to be properly configured from environment variables, so that the notification system works in production.

#### Acceptance Criteria

1. WHEN the server starts THEN it SHALL load VAPID keys from environment variables if available
2. IF VAPID keys are not in environment variables THEN the system SHALL use fallback development keys
3. WHEN VAPID keys are loaded THEN the system SHALL log the configuration status
4. IF web-push initialization fails THEN the system SHALL log the error and continue without notifications
