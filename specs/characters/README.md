# Character specs

One file per character. YAML frontmatter holds the fields code will read; the body is design prose.

## Frontmatter fields

| Field | Type | Notes |
|---|---|---|
| `id` | string | kebab-case, stable; used by Ink scripts and save files |
| `name` | string | full name |
| `nickname` | string? | what people call them |
| `age` | int | |
| `role` | `protagonist` \| `antagonist` \| `support` | |
| `link` | `street` \| `route` \| `port` | protagonists only — their place in the story's power structure |
| `fate` | string | how the character ends; spoilers live here on purpose |
| `home` | landmark id | must exist in `../map/world.yaml` |
| `work` | landmark id | must exist in `../map/world.yaml` |
| `home_district` | district id | must exist in `../map/world.yaml` |
| `vehicle` | string | default vehicle |
| `skills` | list | gameplay abilities that only this character has |
| `voice` | string | speech register, for writers |

## Body sections

`Background` · `Life now` · `Inciting moment` · `Gameplay` · `Arc` · `Voice` · `Relationships`
· `Secrets` · `Mission hooks`
