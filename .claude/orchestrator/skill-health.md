# Skill health ledger

Updated by the orchestrator at the end of each run. See
`.claude/skills/orchestrator/references/skill-lifecycle.md`.

| Skill / agent | uses | ok | fixes | last used | notes |
|---|---|---|---|---|---|
| skill: orchestrator | 4 | 4 | 0 | 2026-10-31 | formato de log índice + runs/ aplicado a SKILL.md, fix-loop.md, validation.md (aprobado por el director) |
| agent: implementer | 16 | 15 | 0 | 2026-10-31 | sonnet ×12, haiku ×3, opus ×1 (mapa, aprobado). 1 detenido a pedido del director (CARD-11 sonnet → opus). Patrón repetido: reporta exit codes reales y mutaciones; a veces deja artefactos de verificación en el repo (card5-*.png) |
| agent: fixer | 0 | 0 | 0 | — | |
| agent: verifier | 1 | 1 | 0 | 2026-10-31 | recaptura de h0.png; la validación de código la hace el orquestador directamente |
| agent: scout | 0 | 0 | 0 | — | |
