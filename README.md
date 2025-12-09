
# Proyecto SRC — Documentación Completa

> Impulsa decisiones informadas con datos precisos mediante una API modular para la consulta, procesamiento y análisis de datos provenientes de múltiples fuentes.

---

## Tabla de contenidos
- [Descripción general](#descripción-general)
- [Características](#características)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Índice de archivos](#índice-de-archivos)
- [Controlador: descripción detallada de funciones](#controlador-descripción-detallada-de-funciones)
- [Instalación](#instalación)
- [Uso](#uso)
- [Contribución](#contribución)
- [Licencia](#licencia)

---

## Descripción general

El proyecto **SRC** proporciona una API robusta para interactuar con múltiples fuentes de datos científicas (SNIB, WorldClim, GBIF, etc.), procesarlas, analizarlas y entregarlas a aplicaciones externas.

Incluye:
- API estructurada con Express.
- Controladores especializados para análisis de nicho y variables ambientales.
- Caché en Redis para acelerar consultas.
- Utilidades de cálculo estadístico (epsilon, score, deciles, histogramas).
- Arquitectura modular para crecer fácilmente.

---

## Características

| Área | Descripción |
|------|-------------|
| 🧱 Arquitectura | Basada en controladores, rutas y utilidades. Soporta integración futura de nuevas fuentes. |
| ⚡ Rendimiento | Uso extensivo de Redis, cacheo de consultas y agrupaciones eficientes. |
| 📊 Análisis | Permite cálculo de relaciones entre taxones, intersecciones, métricas epsilon/score, deciles e histogramas. |
| 🔌 Integración | Conexión con APIs externas de variables ambientales y datos biológicos. |
| 🔐 Seguridad | Validación de parámetros, manejo de errores, aislamiento de fuentes. |

---

## Estructura del proyecto

```
src/
├── Utils
│   ├── redisClient.js
│   └── verb_utils.js
├── controllers
│   └── mdf_controller.js
├── routes
│   └── mdfrouter.js
└── server.js
```

---

## Índice de archivos

### `server.js`
- Configura y ejecuta el servidor **Express**.
- Aplica middleware (JSON, URL-encoded, compresión).
- Conecta las rutas definidas en `mdfrouter.js`.
- Inicia el servidor en el puerto configurado.

---

### `Utils/verb_utils.js`
Utilidades clave:
- Obtención segura de parámetros (`getParam`).
- Generación de identificadores.
- Cálculo de métricas ecológicas:
  - **epsilon**
  - **score** (log y bounded)
- Funciones comparadoras y de mapeo.

---

### `Utils/redisClient.js`
- Configura un cliente Redis.
- Maneja reconexión, errores y operaciones básicas de lectura/escritura.
- Usado para acelerar consultas y mantener datos intermedios.

---

### `controllers/mdf_controller.js`
Contiene toda la lógica de negocio relacionada con:

- Manejo de fuentes de datos (`sourcesDict`).
- Obtención de taxones, variables, secuencias y filtros.
- Procesamiento de relaciones entre especies/variables.
- Cálculo de métricas ecológicas.
- Análisis espacial (por celdas de un grid).
- Construcción de histogramas y deciles.

Lista de funciones documentadas más abajo.

---

### `routes/mdfrouter.js`
Contiene las rutas expuestas públicamente que enlazan con `mdf_controller.js`.

---

## Controlador: descripción detallada de funciones

A continuación se describen las funciones principales del controlador:

---

### `get_sources`
Retorna todas las fuentes de datos disponibles (SNIB, WorldClim, GBIF).

---

### `get_variables`
Consulta las variables disponibles para una fuente determinada.

---

### `getTaxonList`
Devuelve una lista procesada con `{ variable_id, variable }` para una fuente.

---

### `getTaxonFromString`
Filtra un taxón por texto y retorna coincidencias.

---

### `getTaxonChildren`
Dado un nivel taxonómico padre, devuelve los hijos correspondientes (reino → filo → clase → orden → familia → género → especie).

---

### `getOccOnMap`
Función central para:
- Obtener **level_id** de taxones.
- Unificar y deduplicar identifiers.
- Obtener celdas donde ocurren.
- Calcular frecuencia de coocurrencias.
- Devolver `{ cell_id, occ }`.

---

### `getCatArea`
Consulta regiones, resoluciones y devuelve metadatos espaciales.

---

### `getGeoJsonbyGridid`
Devuelve el GeoJSON asociado a un grid.

---

### `get_EpsScrRelation`
La función **más compleja del sistema**. Permite:

- Obtener relaciones de coocurrencia entre:
  - taxones *target*
  - covariables ambientales
- Calcular métricas ecológicas:
  - **epsilon**
  - **score (log o bounded)**
- Exportar:
  - Tabla completa por par target–covar.
  - Score acumulado por celda.
  - Cálculo de **deciles** (1–10).

Guarda resultados en Redis para otras funciones.

---

### `get_EpsScrRelationDecile`
Filtra resultados devolviendo solo los pares que caen en un decil específico.

---

### `get_freq_byrange`
Construye histogramas:
- por rangos de epsilon
- por rangos de score

Usando:
- **crossfilter**
- **d3-scaleQuantile**

---

### `get_EpsScr_bycell`
Genera histogramas basados en la métrica **total_score** por celda.

---

## Instalación

### Requisitos
- Node.js
- Redis
- npm/yarn

### Instalación
```sh
npm install
```

---

## Uso

### Iniciar servidor
```sh
npm start
```

La API quedará disponible bajo las rutas definidas en `mdfrouter.js`.

---

## Contribución
1. Crear un branch nuevo.
2. Enviar PR con descripción de cambios.
3. Los cambios se revisan antes de integrar.

---

## Licencia
Proyecto bajo licencia interna. Ajustable según requerimientos.

---

