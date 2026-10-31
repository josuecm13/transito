# Skill lifecycle: propose, update, retire

The orchestrator watches how work goes and proposes changes to the project's skills and agents
(`.claude/skills/`, `.claude/agents/`). **It only proposes.** The director approves, and an
`implementer` (haiku) then writes the change.

## Ledger: `.claude/orchestrator/skill-health.md`

One row per skill or agent. Update at the end of every run:

| Column | Meaning |
|---|---|
| uses | times invoked |
| ok | outputs that passed validation first try |
| fixes | fix rounds it caused |
| last used | date |
| notes | recurring failure pattern, if any |

## When to propose

| Proposal | Trigger |
|---|---|
| **Create** a skill | The same kind of brief or checklist was written **3+ times** (e.g. "add a mission from the act file", "add a district to the greybox"), or one procedure keeps failing the same way because agents lack context. |
| **Update** a skill or agent | The same failure pattern appears **2+ times** in its notes, or the project changed under it (new stack piece, new spec format). |
| **Retire** a skill or agent | Unused for **2 milestones**, or fixes ≥ ok over 5+ uses (it causes more failures than it prevents), or another skill fully covers it. |

## Proposal format (in the report to the director)

```
SKILL PROPOSAL: create | update | retire  <name>
Evidence: <ledger numbers / log entries>
Change: <one paragraph: what it does or what changes>
Cost: <files touched; references to add/remove>
```

## Design rules for new skills

- `SKILL.md` stays short: rules, flow, and an index of references with "load when".
- Detail lives in `references/*.md`, one concern per file, loaded on demand.
- Skills hold procedures and context, not code. Code lives in the repo.
- Prefer updating an existing skill over creating an overlapping one.
