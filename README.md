# Encuesta de Díadas

Aplicación web para aplicar la Encuesta de Díadas (Fase II de la tesis doctoral «Del umbral universal a la proximidad
relacional», Janus Leonhardt, Doctorado en Arquitectura, Diseño y Estudios Urbanos UC). Implementa el Anexo I completo:
los bloques A a H dirigidos al cuidador, con sus tareas cartográficas, y el módulo pictográfico P que responde la
persona con síndrome de Down.

## Qué hace

- **Encuesta asistida en tablet.** Una pregunta por pantalla, textos personalizados con el nombre de la persona,
  orden aleatorio de los indicadores de E y F, ítems de reserva y tareas opcionales configurables para el piloto.
- **Mapas con Mapbox GL.** Polígonos B1 y B2 dibujados con el dedo (o punto a punto), mapa de preocupaciones B3,
  ubicación de destinos C3 y rutas C10. El estilo del mapa se puede cambiar en cualquier momento y queda registrado.
- **Módulo P.** Tableros de tarjetas con pictogramas ARASAAC al estilo Talking Mats: control de aquiescencia (P2),
  «¿cómo lo haces?» (P3) y «¿cómo te gustaría hacerlo?» (P4).
- **Trazabilidad completa.** Bitácora de eventos con marca de tiempo (cada pantalla, respuesta, trazado, cambio de
  estilo, pérdida de conexión), tiempo por ítem, latencia de la primera respuesta, número de cambios y duración de
  cada dibujo. Queda registrado quién aplicó cada encuesta.
- **Audio.** Grabación de la sesión, si el cuidador la autoriza, en fragmentos de 10 segundos.
- **Sin pérdida de datos.** Todo se guarda primero en el tablet (IndexedDB) y se envía al servidor en cuanto hay
  conexión, con reintentos idempotentes. La aplicación es una PWA y abre sin internet.
- **Consentimiento.** Firma en el tablet o registro de que se firmó en papel, para el cuidador y para la persona
  (lectura fácil con pictogramas y verificación de comprensión).
- **Correos de validación** al iniciar y al cerrar cada encuesta, sin datos sensibles.
- **Portal de administración.** Avance respecto de las 100 díadas, conteo por comuna, perfiles sociodemográficos,
  criterios del piloto (duración por bloque e indicadores con más del 60% en una categoría), gestión de
  encuestadores, exclusión o eliminación de encuestas y exportación.

## Arquitectura

```
frontend/   React + TypeScript + Vite (PWA). Mapbox GL JS, Dexie (IndexedDB).
backend/    Python + FastAPI + SQLAlchemy. Sirve la API y la aplicación web compilada.
shared/     instrument.json: definición única del instrumento (ítems, opciones, códigos), usada por ambos lados.
scripts/    Descarga de pictogramas ARASAAC.
```

Un solo servicio en Railway (Dockerfile) más una base PostgreSQL. Node se usa para construir el front; la API está en
Python.

### Datos sensibles

El nombre, el domicilio, las geometrías (polígonos, rutas, destinos, preocupaciones) y las firmas se guardan cifrados
(AES-256-GCM) en la tabla `survey_sensitive`, separados del resto de las respuestas (`surveys`). El audio también se
cifra. La clave está en la variable `DATA_ENCRYPTION_KEY`: **si se pierde, esos datos no se pueden recuperar.**
Guárdela fuera de Railway, en un lugar seguro.

## Exportación

Desde el portal se descarga un archivo comprimido. Todas las tablas y capas se unen por `id_diada`.

| Archivo | Contenido |
| --- | --- |
| `diadas.csv` | Una fila por díada: ítems cerrados, medidas de B1 y B2, módulo P, duraciones por bloque |
| `diadas.json` | Registro completo y anidado de cada díada |
| `destinos.csv` | Una fila por destino: C1 a C6, órdenes C7 a C9, ruta C10 |
| `tiempos_items.csv` | Una fila por díada e ítem: tiempo, latencia, visitas, cambios |
| `eventos.jsonl` | Bitácora cronológica completa |
| `diccionario_variables.csv` | Etiquetas y códigos |
| `geo/*.geojson` | Hogares, B1, B2, B3, destinos y rutas (WGS84) |

Valores perdidos: `-88` no sabe, `-99` sin respuesta, vacío cuando no corresponde.

## Desarrollo local

```bash
# API
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
MAPBOX_TOKEN=pk... uvicorn app.main:app --reload      # usa SQLite y claves de desarrollo; administrador: clave "admin"
pytest

# Aplicación web
node scripts/fetch-pictograms.mjs                     # una vez, descarga los pictogramas
cd frontend
npm install
npm run dev                                           # http://localhost:5173, con proxy a la API
npm test
```

## Despliegue en Railway

1. Proyecto nuevo desde este repositorio de GitHub (Railway detecta el `Dockerfile`).
2. Agregar una base PostgreSQL y referenciar su `DATABASE_URL` en el servicio.
3. Definir las variables de `.env.example`. En producción son obligatorias `SECRET_KEY`, `DATA_ENCRYPTION_KEY` y
   `ADMIN_PASSWORD`.
4. Generar un dominio público y copiarlo en `APP_URL`.

Cada `git push` a `main` vuelve a desplegar. Los tablets muestran un aviso de actualización en la pantalla de inicio,
nunca en medio de una encuesta.

## Uso en terreno

- Entrar una vez con conexión en cada tablet e instalar la aplicación en la pantalla de inicio.
- Los mapas necesitan conexión para cargar las teselas; el resto de la encuesta funciona sin internet.
- No borrar los datos del navegador mientras haya encuestas con respaldo pendiente.

## Pictogramas

Los símbolos pictográficos utilizados son propiedad del Gobierno de Aragón y han sido creados por Sergio Palao para
ARASAAC (http://www.arasaac.org), que los distribuye bajo Licencia Creative Commons BY-NC-SA.
