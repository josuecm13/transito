# Skill health ledger

Updated by the orchestrator at the end of each run. See
`.claude/skills/orchestrator/references/skill-lifecycle.md`.

| Skill / agent | uses | ok | fixes | last used | notes |
|---|---|---|---|---|---|
| skill: orchestrator | 5 | 5 | 0 | 2026-11-01 | formato de log índice + runs/ aplicado a SKILL.md, fix-loop.md, validation.md (aprobado por el director) |
| agent: implementer | 26 | 24 | 1 | 2026-11-01 | sonnet ×12, haiku ×3, opus ×11 (mapa + #7 completo, aprobado). #7: S5 reportó 10/10 pero falló 1 en validación por cambio concurrente de la red (S4) → 1 fixer. 1 detenido a pedido del director (CARD-11 sonnet → opus). Patrón repetido: reporta exit codes reales y mutaciones; a veces deja artefactos de verificación en el repo (card5-*.png) |
| agent: fixer | 1 | 1 | 0 | 2026-11-01 | opus; falla de polygon-clipping en checker de S5 |
| agent: verifier | 1 | 1 | 0 | 2026-10-31 | recaptura de h0.png; la validación de código la hace el orquestador directamente |
| agent: scout | 0 | 0 | 0 | — | |
| agent: general-purpose | 1 | 1 | 0 | 2026-11-01 | S0: levantar motor geoespacial (infra fuera del repo) |
