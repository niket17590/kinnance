# LLM Guidelines

Use this file as a lightweight handoff guide for Codex, Claude, or any coding assistant working on Kinnance.

## Fast Sync

Before coding:

1. Run `git status --short`.
2. Run `git branch --show-current`.
3. Review recent local commits with `git log --oneline -4`.
4. Use those commits to understand what changed recently.
5. Read only task-relevant files after that.
6. Do not scan the whole repo unless the task truly requires it.
7. Never overwrite or revert uncommitted changes unless explicitly asked.

## Project

Kinnance is a personal portfolio management tool for tracking a household/family portfolio across members, broker accounts, and circles.

Tech stack:
- Frontend: React + Vite
- Backend: FastAPI
- Database/Auth: Supabase/Postgres
- Frontend calls backend APIs only. Backend owns DB access and business logic.

## Global Product Rule

Most pages outside the Manage/Admin area must derive their view from the selected top-bar filters:
- selected circle
- selected members
- selected account types
- selected brokers

Manage/Admin pages can use their own workflows and do not need to follow portfolio filter behavior unless explicitly designed to.

## NFRs

- Keep UI responsive and fast.
- Prefer low-latency API responses.
- Avoid unnecessary full-repo scans, large payloads, and expensive frontend computation.
- Keep dashboard/reporting pages scannable and useful for portfolio decisions.
- Preserve existing design and API patterns unless there is a clear reason to change them.

## Working Style

- Be concise.
- Explain less; focus on the code change or answer.
- Save tokens where possible.
- Ask before major schema, auth, architecture, dependency, or deployment changes.
- Keep changes scoped to the user request.
- Validate with focused compile/build/tests when practical, and mention what was checked.
