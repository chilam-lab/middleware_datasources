#!/usr/bin/env python3
"""
Migra los datos de usuarios de SPECIES a species_users_db.

Origen:
  - niche_integration_202209 (v1 y auth_backend): user_species, session,
    retroalimentacion y las colecciones propias de la v1.
  - meshandregions_db (v2): analisis_historial y las colecciones propias de la v2.

Es repetible: vacía las tablas destino y las vuelve a cargar, así que se corre
una vez para probar y otra el día del corte para traer lo más reciente.

Decisiones (ver README.md):
  - Los ids se conservan (v1 y v2 no chocan: colecciones v1 134–234 y v2 < 134;
    registros v1 ≥ 175,542 y v2 < 175,542). Si llegaran a chocar, el script se
    detiene antes de escribir.
  - Colecciones v1 sin usuario existente y registros/detalles huérfanos no se
    migran (siguen en la base vieja).
  - Las celdas (gridid_*) de los registros v1 se recalculan con las mallas de
    meshandregions_db, igual que la carga de la v2.
  - El detalle v1 pasa al formato de la v2: fecha como texto AAAA-MM-DD y los
    campos taxonómicos también en metadata con las llaves de la plantilla.
  - user_species de la v1 no exigía userid único y hay cuentas que lo comparten:
    la registrada primero lo conserva, las demás reciben uno nuevo, y cada
    colección/historial con ese userid pasa a la cuenta más reciente que ya
    existía cuando se creó (ver fix_shared_userids).

Uso:
  python migrar.py --dry-run     # solo cuenta lo que migraría
  python migrar.py               # migra (vacía y recarga species_users_db)

Credenciales en .env (ver .env.example).
"""
import argparse
import json
import os
import sys
import time
from pathlib import Path

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
SCHEMA_SQL = BASE_DIR / '01_schema.sql'

GRID_COLUMNS = ['64km', '32km', '16km', '8km', 'ageb', 'cue', 'mun', 'state']
# Detalle v1 → llaves de metadata de la plantilla v2.
V1_METADATA_KEYS = [
    ('nombrecientifico', 'scientificname'), ('reino', 'kingdom'), ('phylum', 'phylum'),
    ('clase', 'class'), ('orden', 'order'), ('familia', 'family'), ('genero', 'genus'),
    ('especie', 'species'), ('niveltaxonomico', 'taxonrank'), ('nombrecomun', 'commonname'),
    ('fechatexto', 'fechatexto'),
]
BATCH = 5000


def connect(dbname):
    conn = psycopg2.connect(
        dbname=dbname, host=os.getenv('DB_HOST'), port=os.getenv('DB_PORT', '5432'),
        user=os.getenv('DB_USER'), password=os.getenv('DB_PASSWD'),
        application_name='species_users_db_migracion')
    with conn.cursor() as cur:
        # Las fechas v1 sin zona horaria son hora del centro de México.
        cur.execute("SET TIME ZONE 'America/Mexico_City'")
    return conn


def log(msg):
    print(time.strftime('[%H:%M:%S] ') + msg, flush=True)


def fetch(conn, sql, params=None):
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def insert(conn, table, columns, rows, template=None):
    if not rows:
        return
    with conn.cursor() as cur:
        psycopg2.extras.execute_values(
            cur, f'INSERT INTO {table} ({", ".join(columns)}) VALUES %s', rows,
            template=template, page_size=BATCH)


def fix_shared_userids(users):
    """Cuentas que comparten userid: la más antigua lo conserva y las demás reciben
    uno nuevo. Devuelve (users corregidos, owner(fecha, userid) → userid correcto)."""
    by_id = {}
    for u in users:
        by_id.setdefault(u[4], []).append(u)
    next_id = max(u[4] for u in users) + 1
    fixed, accounts = [], {}  # userid viejo → [(fecha_registro, userid nuevo)]
    for uid, group in by_id.items():
        group.sort(key=lambda u: u[2])
        for i, u in enumerate(group):
            new_id = uid if i == 0 else next_id
            if i > 0:
                next_id += 1
                log(f'  userid {uid} compartido: cuenta registrada el {u[2]} → userid {new_id}')
            fixed.append((*u[:4], new_id, *u[5:]))
            accounts.setdefault(uid, []).append((u[2], new_id))

    def owner(fecha, uid):
        options = accounts.get(uid)
        if not options or len(options) == 1:
            return uid
        day = fecha.date() if hasattr(fecha, 'date') else fecha
        earlier = [new for reg, new in options if reg <= day]
        return earlier[-1] if earlier else options[0][1]

    return fixed, owner


def v1_cells(mesh, points):
    """Celdas de cada punto v1 en las mallas de meshandregions_db: {id: (gridid_64km, …)}."""
    with mesh.cursor() as cur:
        cur.execute('CREATE TEMP TABLE v1_pts (id integer PRIMARY KEY, geom geometry(Point, 4326)) ON COMMIT DROP')
        psycopg2.extras.execute_values(
            cur, 'INSERT INTO v1_pts (id, geom) VALUES %s', points,
            template='(%s, ST_SetSRID(ST_Point(%s, %s), 4326))', page_size=BATCH)
        cur.execute('CREATE INDEX ON v1_pts USING gist (geom)')
        cur.execute('ANALYZE v1_pts')
        for g in GRID_COLUMNS:
            cur.execute(f'ALTER TABLE v1_pts ADD COLUMN gridid_{g} integer')
            t0 = time.time()
            cur.execute(f"""
                UPDATE v1_pts p SET gridid_{g} = c.gridid_{g}
                FROM grid_{g}_aoi c
                WHERE c.the_geom && p.geom AND ST_Intersects(c.the_geom, p.geom)""")
            log(f'    celdas {g}: {cur.rowcount:,} puntos en {time.time() - t0:.0f}s')
        cur.execute(f'SELECT id, {", ".join("gridid_" + g for g in GRID_COLUMNS)} FROM v1_pts')
        result = {r[0]: r[1:] for r in cur.fetchall()}
    mesh.rollback()  # suelta la tabla temporal (no se escribió nada en meshandregions_db)
    return result


def main():
    ap = argparse.ArgumentParser(description='Migra datos de usuarios de SPECIES a species_users_db')
    ap.add_argument('--dry-run', action='store_true', help='solo cuenta, no escribe')
    args = ap.parse_args()
    load_dotenv(BASE_DIR / '.env')

    v1 = connect(os.getenv('SRC_V1_DB', 'niche_integration_202209'))
    mesh = connect(os.getenv('MESH_DB', 'meshandregions_db'))
    dst_name = os.getenv('DST_DB', 'species_users_db')

    # ===== Lectura =====
    users = fetch(v1, 'SELECT name, email, fecha_registro, password, userid, acepta_terminos, procedencia, idioma FROM user_species')
    user_ids = {u[4] for u in users}
    sessions = fetch(v1, 'SELECT sid, sess::text, expire FROM session WHERE expire > now()')
    feedback = fetch(v1, 'SELECT id, email, calificacion, comentario FROM retroalimentacion')

    hist = fetch(mesh, 'SELECT id, userid, uuid_redis, grid_id, min_occ, payload::text, fecha_creacion, meta::text FROM analisis_historial')
    v2_lists = fetch(mesh, 'SELECT id, userid, nombre_datos, estatus, categoria, fecha_carga, fecha_expiracion, tipo_info FROM lista_carga_terceros')
    v2_occ = fetch(mesh, f'SELECT id, id_externo, latitud, longitud, idlista, {", ".join("gridid_" + g for g in GRID_COLUMNS)} FROM occ_terceros')
    v2_det = fetch(mesh, 'SELECT id, idocc, fechaevento, nombrecientifico, reino, phylum, clase, orden, familia, genero, especie, niveltaxonomico, metadata::text FROM detalle_occ_terceros')

    v1_lists_all = fetch(v1, 'SELECT id, id_user_species, nombre_datos, estatus, categoria, fecha_carga, fecha_expiracion, tipo_info FROM lista_carga_terceros')
    v1_lists = [l for l in v1_lists_all if l[1] in user_ids]
    v1_list_ids = {l[0] for l in v1_lists}
    v1_occ_all = fetch(v1, 'SELECT id, id_externo, latitud, longitud, idlista FROM occ_terceros')
    v1_occ = [o for o in v1_occ_all if o[4] in v1_list_ids]
    v1_occ_ids = {o[0] for o in v1_occ}
    det_cols = ['idocc', 'fechaevento'] + [c for c, _ in V1_METADATA_KEYS]
    v1_det_all = fetch(v1, f'SELECT {", ".join(det_cols)} FROM detalle_occ_terceros')
    v1_det = [d for d in v1_det_all if d[0] in v1_occ_ids]

    # Los ids v1 y v2 se conservan: si chocan, mejor detenerse que mezclar datos.
    clash_lists = v1_list_ids & {l[0] for l in v2_lists}
    clash_occ = v1_occ_ids & {o[0] for o in v2_occ}
    v2_orphan_users = {r[1] for r in hist} | {l[1] for l in v2_lists}

    log('Origen:')
    log(f'  cuentas {len(users)} · sesiones vigentes {len(sessions)} · comentarios {len(feedback)}')
    log(f'  v2: historial {len(hist)} · colecciones {len(v2_lists)} · registros {len(v2_occ)} · detalles {len(v2_det)}')
    log(f'  v1: colecciones {len(v1_lists)} de {len(v1_lists_all)} (sin usuario: {len(v1_lists_all) - len(v1_lists)})'
        f' · registros {len(v1_occ):,} de {len(v1_occ_all):,} · detalles {len(v1_det):,} de {len(v1_det_all):,}')
    log(f'  usuarios de la v2 que no existen en user_species: {sorted(v2_orphan_users - user_ids) or "ninguno"}')
    if clash_lists or clash_occ:
        log(f'ERROR: ids repetidos entre v1 y v2 (colecciones {sorted(clash_lists)[:10]}, registros {sorted(clash_occ)[:10]}); no se migra.')
        return 1
    if args.dry_run:
        log('Dry run: no se escribió nada.')
        return 0

    log('Calculando celdas de los registros v1 con las mallas de meshandregions_db…')
    cells = v1_cells(mesh, [(o[0], float(o[3]), float(o[2])) for o in v1_occ])

    users, owner = fix_shared_userids(users)
    hist = [(h[0], owner(h[6], h[1]), *h[2:]) for h in hist]
    v2_lists = [(l[0], owner(l[5], l[1]), *l[2:]) for l in v2_lists]
    v1_lists = [(l[0], owner(l[5], l[1]), *l[2:]) for l in v1_lists]

    # ===== Escritura (una sola transacción) =====
    dst = connect(dst_name)
    with dst.cursor() as cur:
        cur.execute(SCHEMA_SQL.read_text(encoding='utf-8'))
        cur.execute('TRUNCATE detalle_occ_terceros, occ_terceros, lista_carga_terceros, analisis_historial, '
                    'retroalimentacion, session, user_species RESTART IDENTITY')

    insert(dst, 'user_species', ['name', 'email', 'fecha_registro', 'password', 'userid', 'acepta_terminos', 'procedencia', 'idioma'], users)
    insert(dst, 'session', ['sid', 'sess', 'expire'], sessions)
    insert(dst, 'retroalimentacion', ['id', 'email', 'calificacion', 'comentario'], feedback)
    insert(dst, 'analisis_historial', ['id', 'userid', 'uuid_redis', 'grid_id', 'min_occ', 'payload', 'fecha_creacion', 'meta'], hist)

    list_cols = ['id', 'userid', 'nombre_datos', 'estatus', 'categoria', 'fecha_carga', 'fecha_expiracion', 'tipo_info']
    insert(dst, 'lista_carga_terceros', list_cols, v2_lists)
    # v1: estatus booleano → texto de la v2.
    insert(dst, 'lista_carga_terceros', list_cols,
           [(l[0], l[1], l[2], 'activo' if l[3] else 'inactivo', l[4], l[5], l[6], l[7]) for l in v1_lists])

    occ_cols = ['id', 'id_externo', 'latitud', 'longitud', 'idlista'] + ['gridid_' + g for g in GRID_COLUMNS]
    insert(dst, 'occ_terceros', occ_cols, v2_occ)
    insert(dst, 'occ_terceros', occ_cols,
           [(o[0], o[1], o[2], o[3], o[4], *cells.get(o[0], (None,) * len(GRID_COLUMNS))) for o in v1_occ])

    det_dst = ['id', 'idocc', 'fechaevento', 'nombrecientifico', 'reino', 'phylum', 'clase', 'orden', 'familia',
               'genero', 'especie', 'niveltaxonomico', 'metadata']
    insert(dst, 'detalle_occ_terceros', det_dst, v2_det)
    # Los detalles v1 no traen id: la secuencia debe seguir después de los de la v2.
    with dst.cursor() as cur:
        cur.execute("SELECT setval(pg_get_serial_sequence('detalle_occ_terceros', 'id'), "
                    "GREATEST(COALESCE((SELECT MAX(id) FROM detalle_occ_terceros), 0), 1))")
    rows = []
    for d in v1_det:
        rec = dict(zip(det_cols, d))
        meta = {key: rec[col] for col, key in V1_METADATA_KEYS if rec[col] not in (None, '')}
        fecha = rec['fechaevento'].strftime('%Y-%m-%d') if rec['fechaevento'] else None
        rows.append((rec['idocc'], fecha, rec['nombrecientifico'], rec['reino'], rec['phylum'], rec['clase'],
                     rec['orden'], rec['familia'], rec['genero'], rec['especie'], rec['niveltaxonomico'],
                     json.dumps(meta, ensure_ascii=False)))
    insert(dst, 'detalle_occ_terceros', det_dst[1:], rows)

    # Secuencias por encima de los ids migrados.
    with dst.cursor() as cur:
        for table, col in [('user_species', 'userid'), ('retroalimentacion', 'id'), ('analisis_historial', 'id'),
                           ('lista_carga_terceros', 'id'), ('occ_terceros', 'id'), ('detalle_occ_terceros', 'id')]:
            cur.execute(f"SELECT setval(pg_get_serial_sequence('{table}', '{col}'), "
                        f"GREATEST(COALESCE((SELECT MAX({col}) FROM {table}), 0), 1))")
    dst.commit()

    # ===== Verificación =====
    expected = {
        'user_species': len(users), 'session': len(sessions), 'retroalimentacion': len(feedback),
        'analisis_historial': len(hist), 'lista_carga_terceros': len(v2_lists) + len(v1_lists),
        'occ_terceros': len(v2_occ) + len(v1_occ), 'detalle_occ_terceros': len(v2_det) + len(v1_det),
    }
    ok = True
    for table, n in expected.items():
        got = fetch(dst, f'SELECT COUNT(*) FROM {table}')[0][0]
        ok &= got == n
        log(f'  {table:22} {got:>9,} {"OK" if got == n else f"≠ esperado {n:,}"}')
    no_cell = fetch(dst, 'SELECT COUNT(*) FROM occ_terceros WHERE gridid_16km IS NULL')[0][0]
    log(f'  registros sin celda de 16 km (fuera de las mallas): {no_cell:,}')
    log('Migración completa.' if ok else 'Migración con diferencias: revisar.')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
