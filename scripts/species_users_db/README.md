# species_users_db

Base de datos propia para los datos de usuarios de SPECIES, para que no dependan de la base del sistema
actual (`niche_integration_202209`), que dejará de funcionar.

| Tablas | Antes | Uso |
|---|---|---|
| `user_species`, `session` | `niche_integration_202209` | Cuentas y sesiones (`auth_backend`) |
| `retroalimentacion` | `niche_integration_202209` | Comentarios de la v1 |
| `analisis_historial` | `meshandregions_db` | Historial de Nicho y Redes (`middleware_datasources`) |
| `lista_carga_terceros`, `occ_terceros`, `detalle_occ_terceros` | `meshandregions_db` (v2) y `niche_integration_202209` (v1) | Colecciones propias ("Mis datos") |

Las bitácoras de uso de la v1 (`historicos_*`, `gen_link`, `analisis_temporales_red`) no se migran.

## Migración (`migrar.py`)

- Repetible: vacía las tablas de `species_users_db` y las vuelve a cargar.
- Conserva los ids (v1 y v2 no chocan; si llegaran a chocar, se detiene sin escribir).
- No migra colecciones v1 cuyo usuario ya no existe ni registros/detalles huérfanos.
- Recalcula las celdas (`gridid_*`) de los registros v1 con las mallas de `meshandregions_db`.
- Pasa el detalle v1 al formato v2 (fecha `AAAA-MM-DD`; taxonomía también en `metadata`).
- Al final compara conteos.

```bash
cp .env.example .env    # credenciales de manati
python migrar.py --dry-run
python migrar.py
```

Requiere Python 3 con `psycopg2` y `python-dotenv`.

## Corte a producción

1. Correr `python migrar.py` justo antes del corte (trae lo más reciente).
2. `auth_backend` (zacatuche1, `/srv/auth_backend/db-config.env`): `DBNAME=species_users_db` y reconstruir.
3. `middleware_datasources` (Portainer): redesplegar; usa `species_users_db` por omisión
   (variables opcionales `USERS_DB_*` si se quiere otro servidor/usuario).
4. La v1 sigue usando `niche_integration_202209`: las cuentas creadas en la v1 después del corte no
   pasan a la v2 (pendiente: aviso en el registro de la v1 para usar la nueva plataforma).
