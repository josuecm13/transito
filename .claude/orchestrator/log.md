# Orchestrator run log — index

One line per run, newest first. Each run has its own file in `runs/` (`<date>-<milestone>-<slug>.md`)
with goal, decisions, cards (agent/model/outcome/fix rounds), escalations and open items.

| Date | Run | Milestone | Status |
|---|---|---|---|
| 2026-11-24 | [Mapa: verificación, decisiones y plan de distritos](runs/2026-11-24-mapa-distritos-plan.md) | map (#12 2.2–2.5, #13 paso 7) | A+B en main (`63698a0`, push); C+D en main (`b3c44ba`); F1–F6 verdes sin commit (walk-graph arreglado; cobertura procedural en suelo y mapas; capas authored retiradas; istmo horneado en el build, arranque 5,1 s → 0,35 s) |
| 2026-11-23 | [Mapa: composición A1+A2+B1](runs/2026-11-23-mapa-composicion.md) | map (#12 antes de 2.2, #13) | hecho: separación, aeropuerto aislado, El Corredor en cinta; sin commit |
| 2026-11-23 | [Mapa: verificación y opciones](runs/2026-11-23-mapa-opciones.md) | map (#12 / #13) | plan — director eligió el orden recomendado |
| 2026-11-22 | [Mapa desde procedimientos](runs/2026-11-22-mapa-procedural.md) | map reshape (proc) | prototype + render + 7 guards; not wired into the game |
| 2026-11-22 | [Mapa desde cero: I1 Fundación](runs/2026-11-22-mapa-i1-fundacion.md) | map reshape I1 | en curso |
| 2026-11-22 | [Cámara 3D + plan del mapa](runs/2026-11-22-camara-3d-y-plan-mapa.md) | H0 (#9) + map reshape B | C1 implementado (falta prueba en navegador); B1 escrito — 12 preguntas al director |
| 2026-11-22 | [Test hunt + memory blow-up + determinism checks](runs/2026-11-22-map-reshape-test-hunt.md) | map reshape | done — next: track B, reshape plan (new Opus session) |
| 2026-11-01 | [Carro manejable](runs/2026-11-01-h0-carro-manejable.md) | H0 (pedido) | mergeado (PR #10); cámara 3D → #9 |
| 2026-10-31 | [Calles y cuadras derivadas](runs/2026-10-31-h0-calles-issue-7.md) | H0 (#7) | cerrado — mergeado en PR #10 |
| 2026-10-31 | [Menú de pausa + mapa general](runs/2026-10-31-h0-pausa-y-mapa.md) | H0 (#1) | cerrado — siguiente: #7 |
| 2026-10-31 | [Minimapa + skill de log](runs/2026-10-31-h0-minimapa-y-skill.md) | H0 (#1) | cerrado |
| 2026-10-31 | [Planear e implementar H0](runs/2026-10-31-h0-implementacion.md) | H0 (#1) | implementado — H0 se aprueba tras #7 |
| 2026-10-31 | [Investigación moto y tráfico](runs/2026-10-31-h1-investigacion-moto-trafico.md) | H1 (#2) | cerrado (solo investigación) |
| 2026-10-31 | [Análisis del mapa y plan segmentado](runs/2026-10-31-h0-analisis-mapa.md) | H0 (#1) | cerrado |
