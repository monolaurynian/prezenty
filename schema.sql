-- Users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL
);

-- Recipients table
CREATE TABLE IF NOT EXISTS recipients (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    identified_by INTEGER REFERENCES users(id),
    profile_picture VARCHAR(255)
);

-- Presents table
CREATE TABLE IF NOT EXISTS presents (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    recipient_id INTEGER REFERENCES recipients(id),
    comments TEXT,
    is_checked BOOLEAN DEFAULT FALSE,
    reserved_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Session table for connect-pg-simple
CREATE TABLE IF NOT EXISTS "session" (
    "sid" varchar NOT NULL COLLATE "default",
    "sess" json NOT NULL,
    "expire" timestamp(6) NOT NULL
)
WITH (OIDS=FALSE);

ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid");
CREATE INDEX "IDX_session_expire" ON "session" ("expire");