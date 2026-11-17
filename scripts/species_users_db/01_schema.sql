-- Esquema de species_users_db: datos de usuarios de SPECIES (cuentas, sesiones,
-- comentarios, historial de análisis y colecciones propias). Antes vivían en
-- niche_integration_202209 (v1 y auth_backend) y meshandregions_db (v2).
-- Idempotente: se puede correr varias veces.

-- ===== Cuentas y sesiones (auth_backend) =====

CREATE TABLE IF NOT EXISTS user_species (
    name            varchar(100),
    email           varchar(100) NOT NULL,
    fecha_registro  date NOT NULL,
    password        varchar(255),
    userid          serial NOT NULL,
    acepta_terminos boolean,
    procedencia     varchar(255),
    idioma          varchar(5),
    CONSTRAINT user_species_pkey PRIMARY KEY (email),
    CONSTRAINT user_species_userid_key UNIQUE (userid)
);

-- Tabla de connect-pg-simple (express-session).
CREATE TABLE IF NOT EXISTS session (
    sid    varchar NOT NULL,
    sess   json NOT NULL,
    expire timestamp(6) NOT NULL,
    CONSTRAINT session_pkey PRIMARY KEY (sid)
);
CREATE INDEX IF NOT EXISTS idx_session_expire ON session (expire);

CREATE TABLE IF NOT EXISTS retroalimentacion (
    id           serial PRIMARY KEY,
    email        varchar(200),
    calificacion integer,
    comentario   varchar(1000)
);

-- ===== Historial de análisis (middleware_datasources: Nicho y Redes) =====

CREATE TABLE IF NOT EXISTS analisis_historial (
    id             serial PRIMARY KEY,
    userid         integer NOT NULL,
    uuid_redis     varchar(64) NOT NULL,
    grid_id        integer,
    min_occ        integer,
    payload        jsonb NOT NULL,
    fecha_creacion timestamptz NOT NULL DEFAULT now(),
    meta           jsonb
);
CREATE INDEX IF NOT EXISTS idx_analisis_historial_userid ON analisis_historial (userid);

-- ===== Colecciones propias ("Mis datos") =====

CREATE TABLE IF NOT EXISTS lista_carga_terceros (
    id               serial PRIMARY KEY,
    userid           integer NOT NULL,
    nombre_datos     varchar(200),
    estatus          varchar(50),
    categoria        varchar(100),
    fecha_carga      timestamptz DEFAULT now(),
    fecha_expiracion timestamptz,
    tipo_info        varchar(100)
);
CREATE INDEX IF NOT EXISTS idx_lista_carga_terceros_userid ON lista_carga_terceros (userid);

-- gridid_*: celdas de las mallas de meshandregions_db; se calculan al cargar
-- (middleware_datasources consulta las mallas y guarda aquí el resultado).
CREATE TABLE IF NOT EXISTS occ_terceros (
    id           serial PRIMARY KEY,
    id_externo   varchar(255), -- en la v1 hay identificadores de hasta 161 caracteres
    latitud      numeric,
    longitud     numeric,
    idlista      integer REFERENCES lista_carga_terceros (id) ON DELETE CASCADE,
    gridid_64km  integer,
    gridid_32km  integer,
    gridid_16km  integer,
    gridid_8km   integer,
    gridid_ageb  integer,
    gridid_cue   integer,
    gridid_mun   integer,
    gridid_state integer
);
CREATE INDEX IF NOT EXISTS idx_occ_terceros_idlista ON occ_terceros (idlista);

CREATE TABLE IF NOT EXISTS detalle_occ_terceros (
    id               serial PRIMARY KEY,
    idocc            integer REFERENCES occ_terceros (id) ON DELETE CASCADE,
    fechaevento      varchar(20),
    nombrecientifico varchar(200),
    reino            varchar(100),
    phylum           varchar(100),
    clase            varchar(100),
    orden            varchar(100),
    familia          varchar(100),
    genero           varchar(100),
    especie          varchar(150),
    niveltaxonomico  varchar(20),
    metadata         jsonb
);
CREATE INDEX IF NOT EXISTS idx_detalle_occ_terceros_idocc ON detalle_occ_terceros (idocc);

COMMENT ON TABLE user_species IS 'Cuentas de SPECIES (migradas de niche_integration_202209)';
COMMENT ON TABLE lista_carga_terceros IS 'Colecciones propias de v2 (meshandregions_db) y v1 (niche_integration_202209)';
