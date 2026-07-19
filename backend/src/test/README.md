# Tests

**Integration tests only — no mock-based unit tests.** Stubbing repositories proves nothing; it
produces fake coverage. (An early `TeamServiceTest` built on MockK was deleted for exactly this
reason.) Tests boot the full Spring context and talk to a real Postgres and the real cheese-auth
service — depending on those is the point of an integration test, not a smell.

The conventions, the standard test shape, and how to run the suite live in
[`backend/CLAUDE.md` §8](../../CLAUDE.md). Every new endpoint, behaviour, or bug fix gets an
assertion there.
