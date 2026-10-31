# Model routing

## Default table

| Work | Agent | Model |
|---|---|---|
| Find files, symbols, config values, "where is X" | `scout` | haiku |
| Run build / typecheck / tests / validators and report | `verifier` | haiku |
| Diagnosed one-spot fix (error message + file + line known) | `fixer` | haiku |
| Mechanical change across files (rename, wire an import, add a field) | `implementer` | haiku (set `model: haiku`) |
| New module, gameplay system, anything needing design judgment | `implementer` | sonnet |
| Fix that already failed once on haiku | `fixer` | sonnet (set `model: sonnet`) |
| Architecture decisions, cross-system redesign | ask the director first | (opus only if approved) |

Pass `model` on the Agent call to override an agent's default.

## Escalation ladder

```
haiku  → fails once on the same criterion → sonnet
sonnet → fails twice on the same criterion → stop, report to the director with evidence
```

Never retry the same model with the same brief. Each retry must change something: more context,
a narrower card, or a stronger model.

## Cost hygiene

- Don't spawn an agent for something you can check with one read or one command yourself.
- Batch tiny related checks into one `verifier` run.
- Prefer one `scout` with a precise question over an `implementer` that has to explore.
