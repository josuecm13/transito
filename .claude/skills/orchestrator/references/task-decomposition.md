# Task decomposition

## Sizing

A card is right-sized when:
- one agent can finish it in a single pass (roughly ≤ 5 files touched, ≤ ~300 lines changed);
- it has **one** observable outcome;
- its acceptance criteria can be checked by a command or a direct read.

If a card fails twice for scope reasons (agent ran out of room, touched unrelated files), split it.

## Order

1. **Foundations first:** anything other cards import (types, world loader, ECS setup).
2. **Then vertical:** a thin playable path end to end beats a complete subsystem nobody can see.
3. **Parallelize** cards with disjoint file sets; serialize cards that share files.

## Card template

```
### CARD-<n>: <imperative title>
Act / milestone: <e.g. Act 1 / H0>
Agent: implementer | fixer | verifier | scout      Model: haiku | sonnet
Depends on: CARD-<m>, …
Files (expected): <paths>
Spec sources: <spec files/sections the agent must read>
Acceptance criteria:
  - [ ] <checkable statement> → check: <command or read>
  - [ ] typecheck + build pass → check: npm run typecheck && npm run build
Out of scope: <things the agent must not do>
```

## Sources of truth

- Scope and active act: `CLAUDE.md`.
- Mission content: `specs/story/act-*.md`.
- Characters: `specs/characters/*.md` frontmatter.
- World data: `specs/map/world.yaml`. Code reads it; it does not copy its numbers.

When a card would need a spec that doesn't exist or is ambiguous, don't invent it. Put it in
the report as a question for the director.
