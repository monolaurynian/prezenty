const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL || 'postgresql://mati:(Stanislaw333P)@prezenty-prezenty-khu4ar:5432/prezenty';

const pool = new Pool({ connectionString });

const schema = `
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS recipients (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    identified_by INTEGER REFERENCES users(id),
    profile_picture VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS presents (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    recipient_id INTEGER REFERENCES recipients(id),
    comments TEXT,
    is_checked BOOLEAN DEFAULT FALSE,
    reserved_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "session" (
    "sid" varchar NOT NULL COLLATE "default",
    "sess" json NOT NULL,
    "expire" timestamp(6) NOT NULL
)
WITH (OIDS=FALSE);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'session_pkey'
    ) THEN
        ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid");
    END IF;
END$$;

CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
`;

(async () => {
    try {
        await pool.query(schema);
        console.log('Database initialized successfully!');
    } catch (err) {
        console.error('Error initializing database:', err);
        process.exit(1);
    } finally {
        await pool.end();
    }
})(); 