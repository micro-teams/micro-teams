-- Runs once, on the postgres container's first init (docker-entrypoint-initdb.d). The backend owns
-- the "microteams" schema; Hibernate (ddl-auto=update) creates its tables and sequences inside it
-- but never creates the schema itself, so it must exist first. cheese-auth owns "public", which
-- postgres creates by default.
CREATE SCHEMA IF NOT EXISTS microteams;
