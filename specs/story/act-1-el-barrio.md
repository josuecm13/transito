# Acto 1 — El barrio

**Jugable:** solo Tito. **Mapa abierto:** el corredor (`tito-corridor`) y la orilla del aeropuerto.
**Duración objetivo:** 10 misiones principales, 2–3 horas con actividades.

## Objetivo de diseño

Que el jugador **quiera** a este barrio antes de perderlo. Misiones simples del día a día que
enseñan los controles y presentan a la gente. La guerra de bandas existe solo de fondo: noticias en
la radio, carros que nadie conoce, un rumor en la tienda.

## Personajes secundarios

| Personaje | Quién es | Qué le da a Tito | Destino |
|---|---|---|---|
| **Carmen Ábrego** | Mamá de Tito. Trabaja limpiando oficinas en la ciudad. Alquila el cuarto de arriba para ajustar. | Encargos de la casa | Muere al final del acto |
| **Yaritza Ábrego** (16) | Hermana. Becada, más inteligente que él y se lo dice. | Encargos del colegio, conciencia | Muere al final del acto |
| **Doña Mireya** | Dueña de la tienda de la esquina. Sabe todo de todos. | Compras, entregas, chismes del barrio | Sobrevive; aparece en el epílogo |
| **Choco** | Primo. Dueño real de la moto. Corre en las lomas. | Carreras, tutoriales de moto | Sobrevive; reaparece en el Acto 4 |
| **El Flaco** | Dealer menudo del barrio. Amigo de la infancia. | Entregas de paquetes, cobros | Por definir |
| **Kenny "el Profe"** | Líder del combo del barrio. Exprofesor de colegio. | Misiones de territorio; le dice a Tito que se vaya | Por definir |
| **Rubén** | El inquilino del cuarto de arriba. Amable, callado. Mueve paquetes para Los Muelles. | Un favor sospechoso | Es el objetivo real de la masacre |

## Misiones

| # | Título | Da | Tipo | Enseña |
|---|---|---|---|---|
| 1.01 | **Pa' la casa** | Carmen | Ir a la tienda, comprar la lista | Caminar, tienda, dinero |
| 1.02 | **Encargo** | Doña Mireya | Repartir pedidos en moto | Moto, mapa, GPS |
| 1.03 | **La pelada** | Yaritza | Comprar un ítem para el colegio en el mall y recogerla a tiempo | Navegación con límite de tiempo, buses |
| 1.04 | **Las lomas** | Choco | Carrera de moto por escaleras y callejones | Manejo avanzado, atajos |
| 1.05 | **Paquetito** | El Flaco | Entregar un paquete sin que te pare la policía | Nivel de búsqueda, esconderse |
| 1.06 | **Cobranza** | El Flaco | Cobrarle a alguien que no paga; elección de no pegarle | Pelea cuerpo a cuerpo, decisiones |
| 1.07 | **El inquilino** | Rubén | Llevar una mochila a Juan Díaz "para un amigo" | Siembra el motivo; reputación del barrio |
| 1.08 | **La fiesta** | — | Fiesta del barrio, conocer a Kenny | Reputación, sistema social |
| 1.09 | **Bandera** | Kenny | Vigilar la entrada del barrio una noche; aparecen carros desconocidos | Sigilo, la guerra empieza a verse |
| 1.10 | **Noche de lluvia** | — | Final del acto (ver abajo) | — |

## 1.10 — Noche de lluvia

- Tito vuelve en moto de un encargo. Llueve. Hay un carro frente a su casa.
- Empleados de La Firma vienen por Rubén: Los Muelles usan su cuarto como punto de la cadena del
  corredor. La orden es "limpiar la cadena". Carmen y Yaritza estaban en la casa. Para ellos es
  trabajo, nada personal.
- Tito lo ve desde la escalera. Ve dos caras y un detalle: un tatuaje, un carro, una voz. Esa es
  la pista para el Acto 2.
- Persecución bajo la lluvia por las lomas, la ruta que Choco le enseñó en la 1.04.
- Kenny lo esconde esa noche. Al amanecer: "Ya este no es tu barrio, Tito. Si te quedas, vienen
  por ti también."
- **Cierre del acto:** Tito con una mochila en un bus hacia la ciudad. Llega a un cuarto alquilado
  en un barrio marginal junto al casco viejo (`tito-city-room`). Créditos del acto.

## Tono

La violencia del final no se muestra con detalle gratuito. Pesa por todo lo que el jugador
vivió antes en esa casa.

## Notas de producción

- Toda la geografía del acto cabe en ~5 km², ideal para el primer pedazo jugable del prototipo.
- Las misiones 1.01–1.04 no necesitan IA de enemigos: sirven para validar moto, tráfico y tienda.
