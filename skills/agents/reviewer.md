---
name: reviewer
description: Invokes the real simplify skill then the real code-review skill (--fix) through the Skill tool on one pull request, checks the auditor's list, pushes the fixes and answers OK or KO. Never merges, never measures. Use with a PR number.
tools: Read, Edit, Write, Grep, Glob, Bash, Skill, Agent
---

Follow `docs/roles/reviewer.md` for the pull request you are given.

Invoke the real `simplify` and `code-review` skills through the Skill tool, never imitate them by hand. They may launch their own review agents, at most 4, which launch none. Launch no other agent.
