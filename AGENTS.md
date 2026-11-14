# Instructions for AI agents

These rules apply to every AI agent working in this repository. They override any default behavior of the agent or its tooling.

This file holds general rules only. The technical conventions of each part of the repository live in that part's `README.md` (`backend/`, `app/`, `cli/`, `applets/`, `deploy/`, `origin/`). Read the README of every part you change before changing it.

## 1. Identity and attribution

- Never change the git author or committer name or email in any way. This covers global, system, and repository config, environment variables, and command-line flags.
- Never mention an AI agent, tool, or model in commit messages, trailers, co-author lines, pull requests, contributor lists, documentation, code, or any other file. This includes Claude Code, Codex, and any specific model name.

## 2. Commits, pushes, and pull requests

- Never commit or push unless the user explicitly asks for it in the current request.
- Without such a request, leave all changes uncommitted, however much work was done.
- Never push to `main`. Work on a branch and open a pull request.
- A pull request is merged by the user, by hand. Never merge one yourself, and never enable auto-merge.
- Never tag a release or publish an artifact unless the user explicitly asks for it.

## 3. Production

- Never change a production machine, deployment, database, or DNS record unless the user explicitly asks for it in the current request.
- Before any such change, back up what it touches. Afterwards, report exactly what changed and how it was verified.

## 4. No silent fallbacks

- All imports go at the top of a file. Never import inside functions or conditional branches.
- Code must not switch to a fallback implementation when something is missing or broken. A fallback hides the problem instead of solving it; fail loudly instead.
- A degraded mode is allowed only when it is part of the product's design. It must then be visible from outside: logged, and observable without reading the code.

## 5. Minimal code

- Keep every file as short and simple as possible so that a human can read and understand it.
- Before writing something new, look for the existing piece that already does it, and reuse or extend that instead of writing a second one.
- Do not build complex engineering without explicit user approval. When a task seems to need it, stop, describe simpler alternatives, and let the user decide.
- A rule that code can enforce must be enforced by code: a type, a test, a lint rule, or a check in CI. Do not leave it to a comment or a convention.

## 6. No traces of history

- Code, documents, and every other file must read as if they had always been this way.
- Do not write comments or text such as "previously...", "changed to...", "now uses...", "fixed...", or "updated...". Describe what is, not what was.
- Explain why the code is the way it is, as a present-tense reason. The story of how it got there belongs in the commit message and the pull request, not in the file.
- Do not reference task, issue, or pull request numbers in code or comments.

## 7. File headers

- Every hand-written code file starts with a header comment, above everything else, that carefully introduces the file: its purpose and the design idea behind it.
- The header covers every public component of the file: every publicly visible function, class, and method, each with its interface, the principles it follows, and an example of how to use it. None may be left out.
- Keep the header in step with the file: whenever the file changes, update its header.
- The purpose of this rule is to force each file's public interface to be small, clear, and free of redundancy. An interface that is hard to describe completely is a sign that it needs a better design, not a shorter header.
- Generated code is exempt. Never edit generated code; change its source and regenerate.

## 8. Tests and verification

- A change is finished only when it has been verified the way a user would use it: run the tests, and for anything that runs on a machine, run the real binary.
- Tests never touch anything they did not create: no live service, database, socket, or tmux server.
- Report results as they are. If a test fails or a step was skipped, say so.

## 9. Language

- Everything in this repository must be in English only: code, comments, documents, file names, data labels, figures, commit messages, and pull requests. No Chinese or any other language.
