# CLAUDE.md — TRÁNSITO

Prototipo personal, no comercial: juego de mundo abierto con vista cenital, ambientado en un istmo
de Panamá comprimido. Historia, personajes y mundo originales.

## Metodología: un acto a la vez

1. **Se trabaja un solo acto a la vez.** El acto activo se lleva hasta que sus misiones y su
   gameplay sean **funcionales y jugables** antes de pasar al siguiente.
2. **Acto activo: Acto 1 — El barrio** (`specs/story/act-1-el-barrio.md`). Solo Tito, solo el
   corredor y la orilla del aeropuerto.
3. **No construir contenido de actos futuros.** Nada de misiones, personajes jugables, distritos
   detallados ni mecánicas que solo sirvan a actos posteriores. Los actos 2–6 en
   `specs/story/premise.md` son un esbozo, no un plan cerrado.
4. **Los sistemas se construyen cuando el acto activo los necesita.** Ejemplo: cambio de personaje,
   grúa, lanchas o la vista de planificación esperan a su acto. El Acto 1 necesita: caminar, moto,
   tráfico, tienda/dinero, entregas, nivel de búsqueda, pelea cuerpo a cuerpo, reputación de
   barrio, diálogos y misiones.
5. **El mapa también va por partes.** El istmo completo queda definido en `specs/map/world.yaml`,
   pero solo se detalla la zona del acto activo; el resto puede existir como bloques grises.

## El director decide la historia

- **El usuario es el director.** La historia puede cambiar en cualquier momento según lo vea al
  jugar.
- **No reescribir, "mejorar" ni extender la trama por iniciativa propia.** Las ideas de historia se
  proponen como sugerencias y se aplican solo si el director las aprueba.
- Las decisiones abiertas viven en `specs/story/open-questions.md`. Cuando el director decide algo,
  se pasa a la sección "Decided".
- Si un cambio de historia afecta a misiones ya implementadas, señalarlo antes de tocar código.

## Los specs son la fuente de verdad

- `specs/story/`: premisa, actos, preguntas abiertas.
- `specs/characters/`: un archivo por personaje, con frontmatter que lee el código.
- `specs/map/world.yaml`: mapa en datos. La cuadrícula es solo presupuesto de área; la geometría
  (costas, límites, rutas) es lo que se ve. Convenciones en `specs/map/README.md`.
- El código sigue a los specs. Si la implementación necesita cambiar un spec, primero se cambia el
  spec.
- Idioma: historia y personajes en español; convenciones técnicas y código en inglés. Los diálogos
  del juego van en español panameño.

## Validación

Después de tocar `world.yaml` o el frontmatter de los personajes:

```
python tools/render_map_preview.py     # requiere PyYAML
```

Regenera `specs/map/preview.svg` y falla (exit 1) si alguna área, lugar o referencia no cuadra.
Cualquier verificación nueva se prueba primero rompiendo lo que protege: debe fallar y después
volver a pasar.

## Contenido original

Es un juego del género, no una recreación. No se usan mapas, personajes, historias, nombres, UI ni
assets de juegos existentes (GTA incluido). Los lugares reales de Panamá sirven de inspiración y se
registran en `inspired_by`.

## Stack (confirmado)

Web nativo: TypeScript + Vite, Three.js (`WebGPURenderer` con fallback a WebGL2), Rapier (física),
miniplex o bitECS, inkjs (misiones y diálogos), UI con overlay del DOM. Dependencias nuevas fuera
de esta lista se consultan con el director.

## Cómo se trabaja: orquestador

- El desarrollo se dirige con la skill del proyecto `orchestrator`
  (`.claude/skills/orchestrator/`). El orquestador no implementa: divide el trabajo en tareas,
  las delega a los agentes del proyecto (`.claude/agents/`: implementer, fixer, verifier, scout,
  con modelos sonnet/haiku), valida el resultado y propone crear, actualizar o retirar skills.
- Los hitos del acto activo están en `specs/milestones/act-1.md`. Hito actual: **H0, corredor
  caminable**.

## Git

Repo personal: el remoto debe usar el host `github-personal` (ver `../AGENTS.md`). Commit y push
solo cuando el director lo pida.
