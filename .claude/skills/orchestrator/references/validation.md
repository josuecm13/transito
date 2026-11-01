# Validating subagent output

A report saying "done, all tests pass" is a claim. Validate in this order and stop at the first
failure.

## 1. Scope check (read it yourself)

- `git status` / `git diff --stat`: only expected files changed? Nothing in `specs/`, `CLAUDE.md`,
  or `.claude/`?
- New dependencies in `package.json` that weren't allowed?

## 2. Mechanical checks (run them yourself or via `verifier`)

```
npm run typecheck
npm run build
npm test                                  # once tests exist
python tools/render_map_preview.py        # if world.yaml or character frontmatter changed
```

Use the actual exit codes. Never rely on the agent's summary of them.

## 3. Acceptance criteria

Walk every criterion on the card. For each one: pass, fail, or unverifiable. An unverifiable
criterion counts as a fail until a check exists.

## 4. Spec fidelity

Spot-check that the code reads spec data instead of hard-coding it (coordinates, landmark ids,
character fields), and that mission content matches the act file.

## 5. Guard tests

Any test written to enforce an invariant must be mutation-checked: break what it protects, see
it fail, restore it, see it pass. Have a `fixer` or `verifier` do the break-and-restore, then
confirm the restore with `git diff`. Report the check, not just the pass.

## 6. Visual check (gameplay cards)

When a card changes something visible, have a `verifier` start the dev server and capture a
screenshot (headless browser), then look at it yourself. "It compiles" is not "it works".

## Outcome

- All pass → mark the card done in the current run file.
- Any fail → `fix-loop.md` with the exact failing output.
- Agent contradicts what you read in the repo → the repo wins. Re-check directly before reporting.
