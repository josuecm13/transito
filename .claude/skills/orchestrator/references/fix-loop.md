# Fix loop

## 1. Classify the failure

| Class | Signal | Action |
|---|---|---|
| **Local defect** | One error, known file and line | `fixer` (haiku) with the exact output |
| **Spread defect** | Several errors from one cause | `fixer` (sonnet), list every error |
| **Scope miss** | Criterion not attempted, or wrong files touched | Re-brief `implementer` with a narrower card; revert stray edits via a `fixer` |
| **Spec gap** | Criterion can't be met because the spec is silent or contradictory | Stop. Ask the director. |
| **Environment** | Missing tool, network, permissions | Report to the director; don't burn agents on it |

## 2. Diagnose cheaply before fixing

If the cause isn't obvious from the output, send a `scout` (haiku) with one question ("which
file defines X and what calls it?") before sending a fixer.

## 3. Fixer brief must include

- the failing command and its exact output (trimmed to the relevant lines);
- file and line;
- what was already tried (from the run file);
- the single criterion that must pass afterwards.

## 4. Limits

- Max **2 fix rounds per criterion** before moving up the model ladder (`model-routing.md`).
- After sonnet fails twice: stop, report with evidence, and propose options to the director.
- Never loosen or delete a check to make it pass. That is a failure to report, not a fix.

## 5. Log every round

In the current run file (`.claude/orchestrator/runs/…`, linked from `log.md`): card, class, model, round, result. These entries feed the
skill lifecycle.
