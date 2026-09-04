-- Early development versions granted the runtime role access to all future
-- tables. Keep privileges explicit so a new sensitive table cannot become
-- accessible accidentally.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM kaspi_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM kaspi_app;

