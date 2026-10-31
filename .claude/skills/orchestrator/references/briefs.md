# Writing briefs

The brief is the only context a subagent has. Cheap models need explicit briefs.

## Template

```
You are working on TRÁNSITO, a web top-down open-world game (TypeScript, Vite, Three.js,
Rapier). Repo: <absolute path>. Read CLAUDE.md first.

TASK: <card title>
WHY: <one sentence: what this unlocks>

READ FIRST:
- <spec file / section>
- <existing code files to follow for style and patterns>

DO:
- <concrete steps, if the approach is already decided>

ACCEPTANCE CRITERIA (all must hold):
- <criterion> — verify with: <command>

DO NOT:
- edit specs/, CLAUDE.md, or .claude/
- add dependencies not listed here: <allowed deps or "none">
- implement anything for future acts
- commit or push

RETURN (exactly this shape):
- files changed (paths)
- commands you ran and their final result (pass/fail + last lines of output)
- anything you could not do, and why
- assumptions you made
```

## Rules

- Give paths, not descriptions ("`src/world/loadWorld.ts`", not "the world loader").
- Give the check commands. An agent that runs the criteria itself fails less often.
- For fixers: include the **exact failing output**, the file and line, and what was already tried.
- Never include your guess about the cause in a verifier brief. Verifiers report; they don't
  confirm hypotheses.
