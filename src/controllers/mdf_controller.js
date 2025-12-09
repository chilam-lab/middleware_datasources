var debug = require('debug')('verbs:controller')
// var pgp = require('pg-promise')()
var config = require('../../config')
const axios = require("axios");
const redis = require('redis');
const { v4: uuidv4 } = require('uuid');
const crossfilter = require('crossfilter')
const d3 = require('d3')

const redis_client = require('../Utils/redisClient');
var verb_utils = require('../Utils/verb_utils')

// TODO: Esto se reemplazará por un catologo en base de datos de las fuentes de datos disponibles
const sourcesDict = {
	1: { 
	  	id_source: 1, 
	  	nombre: 'SNIB', 
	  	url_catvar: 'http://localhost:8086/spv3/variables', 
	  	url_secuencia: 'http://localhost:8086/spv3/secuencia', 
	  	url_variables: 'http://localhost:8086/spv3/variables/7', 
	  	url_data: 'http://localhost:8086/spv3/get-data/7' 
	 },
	2: { 
	  	id_source: 2, 
	  	nombre: 'WorldClim', 
	  	url_catvar: 'http://localhost:8088/wc/variables', 
	  	url_secuencia: 'http://localhost:8086/wc/secuencia', 
	  	url_variables: 'http://localhost:8088/wc/variables/1', 
	  	url_data: 'http://localhost:8088/wc/get-data/3' 
	 },
	 3: { 
	  	id_source: 3, 
	  	nombre: 'GBIF', 
	  	url_catvar: 'http://localhost:8086/gbif1/variables', 
	  	url_secuencia: 'http://localhost:8086/gbif1/secuencia', 
	  	url_variables: 'http://localhost:8089/gbif1/variables/7', 
	  	url_data: 'http://localhost:8089/gbif1/get-data/7' 
	 }
};

const url_gridid = "http://localhost:8085/regions/region-cells/"
const url_geojson = "http://localhost:8085/regions/region-grids/"

exports.get_sources = async function(req, res) {

	debug("get_sources")

	const fuentes = Object.values(sourcesDict).map(fuente => ({
	    id_source: fuente.id_source,
	    nombre: fuente.nombre
	  }));

	res.status(200).json({
		response: fuentes
	})

}


exports.get_variables = async function(req, res) {

	debug("get_variables")

	let id_source = verb_utils.getParam(req, 'id_source', 1)
	let fuente = sourcesDict[id_source];

	console.log("fuente: " + fuente.url_catvar)

	const config = {
      headers: {
          'Content-Type': 'application/json',
      }
  };

	try {

    	const response = await axios.get(fuente.url_catvar, config);
    	// console.log(response.data)

    	res.status(200).json({
				data: response.data
			})

    			      
  } 
  catch (error) {
    	console.error(`❌ Error enviando a ${fuente.url_catvar}:`, error.message);

    	return res.status(404).json({ 
	  		error: 'Error la llamar el servicio' 
	  	});

  }
	

}


exports.getTaxonList = async function(req, res) {

	debug("getTaxonList")

	let source_id = verb_utils.getParam(req, 'source_id', 1)
	let fuente = sourcesDict[source_id];
	// console.log("fuente: " + fuente.url_catvar)

	
	const config = {
      headers: {
          'Content-Type': 'application/json',
      }
  };

	try {

    	const response = await axios.get(fuente.url_catvar, config);
    	// console.log(response.data.data)

    	let taxon_list = response.data.data.map(function(item){
    		return {
    			variable_id:item.id,
    			variable: item.variable
    		}
    	})

    	res.status(200).json({
				data: taxon_list
			})

    			      
  } 
  catch (error) {
    	console.error(`❌ Error enviando a ${fuente.url_catvar}:`, error.message);

    	return res.status(404).json({ 
	  		error: 'Error la llamar el servicio' 
	  	});

  }
	

}


exports.getTaxonFromString = async function(req, res) {

	debug("getTaxonFromString")

	let variable_id = verb_utils.getParam(req, 'variable_id', 7)
	let variable = verb_utils.getParam(req, 'variable', "especie")
	let taxon_string = verb_utils.getParam(req, 'taxon_string', "")
	let source_id = verb_utils.getParam(req, 'source_id', 1)

	let fuente = sourcesDict[source_id];
	let url = fuente.url_catvar + "/" + variable_id
	console.log("url: + " + url)
	
	
	const config = {
      headers: {
          'Content-Type': 'application/json',
      }
  };

  let query = variable + " = " + taxon_string

  let body = {
			q: query, 
			offset: 0, 
			limit: 10
	}

	try {

    	const response = await axios.post(url, body, config);
    	// console.log(response.data)

    	res.status(200).json({
				data: response.data.data
			})

    			      
  } 
  catch (error) {
    	console.error(`❌ Error enviando a ${fuente.url_catvar}:`, error.message);

    	return res.status(404).json({ 
	  		error: 'Error la llamar el servicio' 
	  	});

  }
	

}



exports.getTaxonChildren = async function(req, res) {

	debug("getTaxonChildren")

	let parentLevel = verb_utils.getParam(req, 'parentLevel', 'reino')
	let parentValue = verb_utils.getParam(req, 'parentValue', '')
	let childLevel = verb_utils.getParam(req, 'childLevel', '')
	let source_id = verb_utils.getParam(req, 'source_id', 1)
	let fuente = sourcesDict[source_id];

	console.log("parentLevel: " + parentLevel)
	console.log("parentValue: " + parentValue)
	console.log("childLevel: " + childLevel)

	let url = fuente.url_secuencia
	console.log("url: + " + url)
	
	
	const config = {
      headers: {
          'Content-Type': 'application/json',
      }
  };


  let body = {
			variableLevel: parentLevel, 
			variableValue: parentValue, 
			nextVariableLevel: childLevel
	}

	try {

    	const response = await axios.post(url, body, config);
    	console.log(response.data.data)

    	raw = response.data.data

    	const items = (raw || []).map((row, i) => {
			  // toma la PRIMERA llave y su valor (o usa el childLevel como en el ejemplo previo)
			  const key = Object.keys(row)[0];               // p.ej. "generovalido"
			  const val = (row[key] ?? '').toString().trim();// p.ej. "Canis"

				console.log(key)
				console.log(val)
			  console.log(row)


			  return {
			    value: row.label,               // <- el valor real del taxón
			    label: val,               // <- lo que se muestra en UI
			    meta: { sourceKey: key, ...row }
			  };
			});


			return res.status(200).json(items);
    	
    	// res.status(200).json({
			// 	data: response.data.data
			// })

    			      
  } 
  catch (error) {
    	console.error(`❌ Error enviando a ${fuente.url_catvar}:`, error.message);

    	return res.status(404).json({ 
	  		error: 'Error la llamar el servicio' 
	  	});

  }
	

}



exports.getOccOnMap = async function(req, res) {

	debug("getOccOnMap")

	let grid_id = verb_utils.getParam(req, 'grid_id', 1)
	let array_splist = verb_utils.getParam(req, 'array_splist', [])
	let source_id = verb_utils.getParam(req, 'source_id', 1)

	const fuente = sourcesDict[source_id];
  if (!fuente) {
    return res.status(400).json({ error: 'source_id inválido' });
  }


  const urlQuery = fuente.url_variables; // PASO 1
  const urlData  = fuente.url_data;  // PASO 2

  if (!urlQuery || !urlData) {
    return res.status(500).json({ error: 'Configuración de fuente incompleta (url_query / url_data)' });
  }

	
	console.log("url_variables: + " + urlQuery);
	console.log("url_data: + " + urlData);
	
	const axiosCfg = { headers: { 'Content-Type': 'application/json' } };

	const config = {
      headers: {
          'Content-Type': 'application/json',
      }
  };

  try {
    // =========================
    // PASO 1: obtener level_id
    // =========================
    const limit  = 1000;
    const offset = 0;

    console.log(array_splist)

    // Para cada item del array, construimos q y pedimos level_id
    const levelIdArrays = await Promise.all(
      
      array_splist.map(async (item) => {

      	// console.log(item)
        
        // Limpieza mínima del valor (si lleva espacios => comillas)
        const nivel = String(item.nivel || '').trim();
        const valorRaw = String(item.valor || '').trim();
        const valor = /\s/.test(valorRaw) ? `"${valorRaw}"` : valorRaw;
        const q = `${nivel} = ${valor}`;

        // console.log("q: + " + q);

        const bodyQuery = { q, offset, limit };
        const resp = await axios.post(urlQuery, bodyQuery, axiosCfg);

        // resp.data.data = array de objetos que traen level_id: number[]
        const rows = resp.data?.data || [];
        const collected = [];

        for (const row of rows) {
          const ids = Array.isArray(row.level_id) ? row.level_id : [];
          for (const id of ids) {
            if (id != null) collected.push(Number(id));
          }
        }

        return collected;
      })

    );

    // console.log("En espera de consumo del servicio");
    console.log(levelIdArrays);

    // Unificar y deduplicar level_id
    const levelsSet = new Set();
    for (const arr of levelIdArrays) {
      for (const id of (arr || [])) {
        if (!Number.isNaN(id)) levelsSet.add(Number(id));
      }
    }

    const levels_id = Array.from(levelsSet);
    if (levels_id.length === 0) {
      // No hay nada que consultar en el paso 2
      return res.status(200).json({ data: [] });
    }

    console.log(levels_id);

    // ====================================================
    // PASO 2: obtener cells por los level_id (en un batch)
    // ====================================================
    // Si esperas MUCHOS level_id, podrías trocear en chunks:
    const chunkSize = 800; // ajusta si tu API tiene límites
    const chunks = [];

    for (let i = 0; i < levels_id.length; i += chunkSize) {
      chunks.push(levels_id.slice(i, i + chunkSize));
    }


    const dataResponses = await Promise.all(
      chunks.map(async (levelsChunk) => {
        const bodyData = {
          grid_id,
          levels_id: levelsChunk,
          filter_names: [],
          filter_values: []
        };
        const resp = await axios.post(urlData, bodyData, axiosCfg);
        return resp.data; // se espera un array de objetos con "cells"
      })
    );

    // dataResponses es un array de arrays; aplanamos
    const flatData = dataResponses.flat();

    // ====================================
    // CONTABILIZAR FRECUENCIAS DE CELDAS
    // ====================================
    const freq = new Map(); // cell_id -> occ

    for (const row of flatData) {
      const cells = Array.isArray(row?.cells) ? row.cells : [];
      for (const cellId of cells) {
        const cid = Number(cellId);
        if (Number.isNaN(cid)) continue;
        freq.set(cid, (freq.get(cid) || 0) + 1);
      }
    }

    // Convertir a arreglo [{ cell_id, occ }]
    const result = Array.from(freq.entries()).map(([cell_id, occ]) => ({ cell_id, occ }));
    // (opcional) ordenar por occ desc
    result.sort((a, b) => b.occ - a.occ);

    return res.status(200).json({ data: result });

  
    			      
  } 
  catch (error) {
    
    console.error('❌ Error en getOccOnMap:', error?.response?.data || error.message);
    return res.status(500).json({
      error: 'Error al procesar getOccOnMap',
      details: error?.response?.data || error.message
    });

  }
	

}

exports.getOccMapaAnalisisNicho = async function(req, res) {

	debug("getOccMapaAnalisisNicho")

	let grid_id = verb_utils.getParam(req, 'grid_id', 1)

	let array_splist_target = verb_utils.getParam(req, 'array_splist_target', [])

	let array_splist_covars = verb_utils.getParam(req, 'array_splist_covars', [])






}






exports.getCatArea = async function(req, res) {

	debug("getCatArea")

	let regionId = verb_utils.getParam(req, 'region_id', null)

	try {

		const config = {
	        headers: {
	            'Content-Type': 'application/json',
	        }
	    };

		const url = url_geojson
		// console.log("url: " + url)

		const jsonData = await axios.get(url, config);
		// console.log(jsonData.data.data)

		const regionMap = new Map();

		jsonData.data.data.forEach(item => {
		  
		  // const regions = item.footprint_region.split(";").map(r => r.trim());
		  const region = item.footprint_region;

		  const resolution = {grid_id: item.grid_id, resolution: item.resolution}

		  // regions.forEach(region => {

		    if (!regionMap.has(region)) {
		      regionMap.set(region, {
		        id: item.grid_id, // Primer ID encontrado
		        resolutions: new Set()
		      });
		    }

		    regionMap.get(region).resolutions.add(resolution);

		  // });

		});



		if (regionId === null) {
	    // Regiones disponibles con su ID
	    const regionList = Array.from(regionMap.entries()).map(([name, { id }]) => ({
	      id,
	      name
	    }));
	    
	    res.status(200).json({
	    	regions: regionList
	    })

	  } else {
	    // Buscar región por ID
	    const regionEntry = Array.from(regionMap.entries()).find(([, value]) => value.id === regionId);

	    if (!regionEntry) {
	      
	      res.status(200).json({
		    	error: "Región no encontrada para el ID proporcionado." 
		    })
	    }

	    const [name, { resolutions }] = regionEntry;

	    res.status(200).json({
	    	region: name,
	      resolutions: Array.from(resolutions)
	    })

	  }
  	
  	

	} 
	catch (error) {
	    console.error('Error en la petición:', error.response ? error.response.data : error.message);

    	return res.status(404).json({ 
	  		error: 'Error al llamar el servicio' 
	  	});

	}

}



// Función principal
function getRegionInfo(regionId = null) {
  
  if (regionId === null) {
    // Regiones disponibles con su ID
    const regionList = Array.from(regionMap.entries()).map(([name, { id }]) => ({
      id,
      name
    }));
    return { regions: regionList };
  } else {
    // Buscar región por ID
    const regionEntry = Array.from(regionMap.entries()).find(([, value]) => value.id === regionId);
    if (!regionEntry) {
      return { error: "Región no encontrada para el ID proporcionado." };
    }

    const [name, { resolutions }] = regionEntry;
    return {
      region: name,
      resolutions: Array.from(resolutions)
    };
  }
}


exports.getGeoJsonbyGridid = async function(req, res) {

	debug("getGeoJsonbyGridid")

	let grid_id = verb_utils.getParam(req, 'grid_id', 1)

	try {

		const config = {
	        headers: {
	            'Content-Type': 'application/json',
	        }
	    };

		const url = url_geojson+grid_id
		console.log("url: " + url)

		const response = await axios.get(url, config);
  	
  	res.status(200).json({
			geo_json: response.data.json
		})
  	

	} 
	catch (error) {
	    console.error('Error en la petición:', error.response ? error.response.data : error.message);

    	return res.status(404).json({ 
	  		error: 'Error al llamar el servicio' 
	  	});

	}

}


exports.get_EpsScrRelation = async function(req, res) {
  debug("get_EpsScrRelation");

  const grid_id     = verb_utils.getParam(req, 'grid_id', 1);
  const min_occ     = verb_utils.getParam(req, 'min_occ', 5);
  const target_body = verb_utils.getParam(req, 'target', {});
  const covars_body = verb_utils.getParam(req, 'covars', {});

  try {
    const n                 = await getGridLength(grid_id);   // #celdas del grid
    const target_ids_array  = await getSourceIds(target_body);
    const covars_ids_array  = await getSourceIds(covars_body);
    const targetCells_data  = await getDataInterccion(target_ids_array, grid_id);
    const covarsCells_data  = await getDataInterccion(covars_ids_array, grid_id);

    const resultados = [];
    const acumuladosPorCelda = Object.create(null);

    // Para evitar sumar más de una vez la misma coocurrencia por celda
    // (target, covar) en la misma celda:
    const seenCellPair = new Set(); // clave: `${cell}|${id_target}|${id_covars}`

    // Si quieres que el mapa use la versión bounded (suma estable):
    const USE_BOUNDED_FOR_MAP = true;

    // Helpers
    const toSet = arr => new Set(Array.isArray(arr) ? arr : []);
    const intersectSets = (A, B) => {
      const out = [];
      // itera sobre el set más pequeño
      const [small, large] = (A.size <= B.size) ? [A, B] : [B, A];
      for (const v of small) if (large.has(v)) out.push(v);
      return out; // array de celdas únicas en la intersección
    };

    for (const obj1 of targetCells_data) {
      for (const item1 of obj1.data) {

        // Celdas únicas para el target
        const targetCellsSet = toSet(item1.cells);
        const id_target = item1.level_id;
        const ni_unique = targetCellsSet.size; // # de celdas donde aparece el target

        for (const obj2 of covarsCells_data) {
          for (const item2 of obj2.data) {
            const id_covars = item2.level_id;

            // misma variable → saltar
            if (id_target === id_covars) continue;

            // Celdas únicas para la covariable
            const covarCellsSet = toSet(item2.cells);
            const nj_unique = covarCellsSet.size;

            // Intersección por CELDAS ÚNICAS (coocurrencias por celda, no por ocurrencia)
            const interCells = intersectSets(targetCellsSet, covarCellsSet);
            const nij_unique = interCells.length;

            // Regla: solo si hay al menos min_occ celdas en común
            if (nij_unique < min_occ) continue;

            // === Métricas con conteo por celdas únicas ===
            const epsilon = verb_utils.getEpsilon(nj_unique, nij_unique, ni_unique, n);

            // Score en log-ratio (negativo/positivo).
            const score_log     = verb_utils.getScore(nj_unique, nij_unique, ni_unique, n, { mode: 'log',     alpha: 0.5 });
            const score_bounded = verb_utils.getScore(nj_unique, nij_unique, ni_unique, n, { mode: 'bounded', alpha: 0.5 });

            // Para la tabla: guardo los valores por par (target, covar)
            resultados.push({
              idsource_target: obj1.id_source,
              metadata_target: item1.metadata,
              idsource_covars: obj2.id_source,
              metadata_covars: item2.metadata,
              id_target,
              id_covars,
              num_nij: nij_unique, // celdas únicas compartidas
              ni: ni_unique,
              nj: nj_unique,
              n,
              epsilon,
              score: score_log
            });

            // Para el mapa: sumar UNA VEZ por celda en interCells para este par
            for (const cell of interCells) {
              const key = `${cell}|${id_target}|${id_covars}`;
              if (seenCellPair.has(key)) continue;   // ya sumado este par en esa celda
              seenCellPair.add(key);

              if (!acumuladosPorCelda[cell]) {
                // acumuladosPorCelda[cell] = { cell, total_epsilon: 0, total_score: 0, k: 0 };
                acumuladosPorCelda[cell] = { cell, total_score: 0, k: 0 };
              }
              // acumuladosPorCelda[cell].total_epsilon += epsilon;
              acumuladosPorCelda[cell].total_score   += (USE_BOUNDED_FOR_MAP ? score_bounded : score_log);
              acumuladosPorCelda[cell].k += 1;
            }
          }
        }
      }
    }

    // Para el mapa: dejamos la estructura actual (total_score + k)
    const resumenPorCelda = Object.values(acumuladosPorCelda);

    // Ordena tabla por magnitud de epsilon (o por score)
    const resp_ordenado = resultados.sort((a, b) => Math.abs(b.epsilon) - Math.abs(a.epsilon));

    // === NUEVO: cálculo de deciles del score por celda ===
    let scoreDeciles = [];

    if (resumenPorCelda.length) {
      // 1) score por celda = total_score / k
      const cellsWithScore = resumenPorCelda
        .map(o => {
          const total = o.total_score ?? 0;
          const k     = o.k ?? 1;
          const score_cell = k ? (total / k) : 0;
          return {
            cell: o.cell,
            score_cell
          };
        })
        .filter(o => !Number.isNaN(o.score_cell));

      if (cellsWithScore.length) {
        // 2) Ordenamos por score ascendente para crear deciles
        const sorted = cellsWithScore.slice().sort((a, b) => a.score_cell - b.score_cell);
        const m = sorted.length;

        // 3) Agregadores por decil (1..10)
        const decAgg = Array.from({ length: 10 }, () => ({ sum: 0, count: 0 }));

        sorted.forEach((row, idx) => {
          // idx: 0..m-1 → decIndex: 0..9
          const decIndex = Math.min(9, Math.floor((idx * 10) / m));
          decAgg[decIndex].sum   += row.score_cell;
          decAgg[decIndex].count += 1;
        });

        // 4) Promedio por decil
        scoreDeciles = decAgg
          .map((agg, index) => {
            const decil = index + 1; // 1..10 (1 = scores más bajos, 10 = más altos)
            const avg   = agg.count ? (agg.sum / agg.count) : 0;
            return {
              decil,
              avg_score_cell: avg,
              cell_count: agg.count
            };
          })
          // Si quieres, puedes filtrar deciles vacíos:
          .filter(d => d.cell_count > 0);

        // Opcional: si quieres devolver del 10 al 1 ya ordenado:
        scoreDeciles.sort((a, b) => b.decil - a.decil);
      }
    }
    // === FIN NUEVO ===

    // Guarda en Redis (si lo estás usando)
    const id = uuidv4();
    await redis_client.set(id + "_EpsScrpRel", JSON.stringify(resp_ordenado), { EX: 15 * 60 });
    await redis_client.set(id + "_EpsScrCell", JSON.stringify(resumenPorCelda), { EX: 15 * 60 });

    // === NUEVO: devolvemos también scoreDeciles ===
    res.status(200).json({
      EpsScrpRel: resp_ordenado,     // tabla de pares target-covar
      EpsScrCell: resumenPorCelda,   // score acumulado por celda
      scoreDeciles,                  // ⬅️ promedio de score por celda en cada decil
      uuid: id
    });

  } catch (error) {
    console.error('Error en la petición:', error?.response ? error.response.data : error.message);
    res.status(500).json({ error: 'get_EpsScrRelation failed' });
  }
};



// En tu controlador de nicho (mismo archivo donde está get_EpsScrRelation)
exports.get_EpsScrRelationDecile = async function(req, res) {
  debug("get_EpsScrRelationDecile");

  const uuid   = verb_utils.getParam(req, 'uuid', null);
  const decile = parseInt(verb_utils.getParam(req, 'decile', 10), 10);
  const metric = verb_utils.getParam(req, 'metric', 'epsilon'); // 'epsilon' | 'score'

  if (!uuid) {
    return res.status(400).json({ error: 'Falta uuid' });
  }
  if (Number.isNaN(decile) || decile < 1 || decile > 10) {
    return res.status(400).json({ error: 'Decil inválido (1–10)' });
  }
  if (!['epsilon', 'score'].includes(metric)) {
    return res.status(400).json({ error: 'Métrica inválida (epsilon|score)' });
  }

  try {
    const key = uuid + "_EpsScrpRel";
    const raw = await redis_client.get(key);
    if (!raw) {
      return res.status(404).json({ error: 'No se encontró EpsScrpRel para ese uuid' });
    }

    /** @type {Array<any>} */
    const rows = JSON.parse(raw);

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.json([]);
    }

    // Ordenamos por la métrica elegida
    const sorted = [...rows].sort((a, b) => {
      const av = Number(a[metric] ?? 0);
      const bv = Number(b[metric] ?? 0);
      return av - bv;
    });

    const getPercentile = (arr, p) => {
      const n = arr.length;
      if (n === 0) return NaN;
      const idx = (p / 100) * (n - 1);
      const lower = Math.floor(idx);
      const upper = Math.ceil(idx);
      if (lower === upper) return Number(arr[lower][metric] ?? 0);
      const w = idx - lower;
      const vLow = Number(arr[lower][metric] ?? 0);
      const vUp  = Number(arr[upper][metric] ?? 0);
      return vLow * (1 - w) + vUp * w;
    };

    const pLow  = (decile - 1) * 10;
    const pHigh = decile * 10;

    const minVal = getPercentile(sorted, pLow);
    const maxVal = getPercentile(sorted, pHigh);

    // Filtramos filas que caen en ese rango de la métrica
    const filtered = rows.filter(r => {
      const v = Number(r[metric] ?? 0);
      return v >= minVal && v <= maxVal;
    });

    return res.json({
      uuid,
      decile,
      metric,
      min: minVal,
      max: maxVal,
      count: filtered.length,
      rows: filtered
    });

  } catch (err) {
    console.error('get_EpsScrRelationDecile error:', err);
    return res.status(500).json({ error: 'get_EpsScrRelationDecile failed' });
  }
};





exports.get_freq_byrange = async function(req, res) {

	debug("get_freq_byrange")

	let uuid = verb_utils.getParam(req, 'uuid')

	let num_buckets = verb_utils.getParam(req, 'num_buckets', 20)
	
	try {

		const data = await redis_client.get(uuid + "_EpsScrpRel");
  	if (!data) {
  		return res.status(404).json({ 
	  		error: 'Dato no encontrado o expirado' 
	  	});
  	}

  	let data_json = JSON.parse(data)
  	// console.log(data)

  	var min_eps = d3.min(data_json.map(function(d) {return parseFloat(d.epsilon);}));
    debug("min_eps: " + min_eps)

    var max_eps = d3.max(data_json.map(function(d) {return parseFloat(d.epsilon);}));
    debug("max_eps: " + max_eps)

    var min_scr = d3.min(data_json.map(function(d) {return parseFloat(d.score);}));
    debug("min_scr: " + min_scr)

    var max_scr = d3.max(data_json.map(function(d) {return parseFloat(d.score);}));
    debug("max_scr: " + max_scr)

    var beans = d3.range(1,num_buckets+1,1);
    var epsRange = d3.scaleQuantile().domain([min_eps, max_eps]).range(beans);
    var scrRange = d3.scaleQuantile().domain([min_scr, max_scr]).range(beans);

    var cross_species = crossfilter(data_json)
    cross_species.groupAll();

    var eps_dimension = cross_species.dimension(function(d) { return parseFloat(d.epsilon); });
    var scr_dimension = cross_species.dimension(function(d) { return parseFloat(d.score); });

    var groupByEpsilon = eps_dimension.group(function(d){
      return epsRange(d)
    });
    
    var groupByScore = scr_dimension.group(function(d){
      return scrRange(d)
    });
    
    var data_eps = groupByEpsilon.top(Infinity);
    data_eps.sort(verb_utils.compare);
    
    var data_scr = groupByScore.top(Infinity);
    data_scr.sort(verb_utils.compare);
    
		res.status(200).json({
			epsilon: data_eps,
			epsilon_quatiles: epsRange.quantiles(),
			score: data_scr,
			score_quatiles: scrRange.quantiles(),
			uuid: uuid
		})

	} 
	catch (error) {
	    console.error('Error en la petición:', error.response ? error.response.data : error.message);
	}
	
  	
}


exports.get_EpsScr_bycell = async function(req, res) {

  debug("get_EpsScr_bycell");

  const uuid = verb_utils.getParam(req, 'uuid');
  const num_buckets = verb_utils.getParam(req, 'num_buckets', 20);

  try {

    if (!uuid) {
      return res.status(400).json({ error: 'uuid requerido' });
    }

    const data = await redis_client.get(uuid + "_EpsScrCell");
    if (!data) {
      return res.status(404).json({
        error: 'Dato no encontrado o expirado'
      });
    }

    const data_json = JSON.parse(data);

    // ---- calcular histogramas por total_score ----
    const scores = data_json.map(d => parseFloat(d.total_score));

    const min_scr = d3.min(scores);
    debug("min_scr: " + min_scr);

    const max_scr = d3.max(scores);
    debug("max_scr: " + max_scr);

    const beans = d3.range(1, num_buckets + 1, 1);
    const scrRange = d3.scaleQuantile()
                       .domain([min_scr, max_scr])
                       .range(beans);

    const cross_species = crossfilter(data_json);
    cross_species.groupAll();

    const scr_dimension = cross_species.dimension(d => parseFloat(d.total_score));

    const groupByScore = scr_dimension.group(d => scrRange(d));
    let data_scr = groupByScore.top(Infinity);
    data_scr.sort(verb_utils.compare);

    const score_quatiles = scrRange.quantiles ? scrRange.quantiles() : [];

    // ✅ ÚNICA respuesta
    return res.status(200).json({
      score: data_scr,
      score_quatiles,
      uuid
    });

  } catch (error) {
    console.error('Error en la petición get_EpsScr_bycell:',
      error && error.response ? error.response.data : error.message
    );

    // Evitar "Cannot set headers after they are sent to the client"
    if (!res.headersSent) {
      return res.status(500).json({ error: 'get_EpsScr_bycell failed' });
    }
    // si ya se enviaron headers, solo logueamos
  }
};



// Funciones de apoyo para la ejecución de los servicios publicos

async function getSourceIds(body_request){

	let source_ids_array = []
	const config = {
	        headers: {
	            'Content-Type': 'application/json',
	        }
	    };


	for (const item of body_request) {
    	// console.log(item)
    	
    	let temp_response = {}
    	temp_response.id_source = item.id_source

    	let fuente = sourcesDict[item.id_source];
    	let body = {
    			q: item.q, 
    			offset: item.offset, 
    			limit: item.limit
			}

    	try {

    		// responde los ids dado el query
	      	const response = await axios.post(fuente.url_variables, body, config);
	      	// console.log(response.data.data)

	      	let response_fullbody = response.data.data
	      	// console.log(temp_response)

	      	// agrupa los ids resultantes en un solo array
	      	const ids_array = response_fullbody.map(function(item){
				return item.level_id
			}).flat()
			// console.log(ids_array)

			// const data_target = response_fullbody.map(function(item){
			// 	return {level_id:item.level_id, metadata: item.datos}
			// })
			// console.log(data_target)


			temp_response.id_array = ids_array
			// temp_response.metadata = data_target
			
	      	source_ids_array.push(temp_response)
	      			      
	    } 
	    catch (error) {
	      	console.error(`❌ Error enviando a ${fuente.url_variables}:`, error.message);
	    }

    }

    return source_ids_array

}

async function getDataInterccion(ids_array, grid_id){

	const config = {
	        headers: {
	            'Content-Type': 'application/json',
	        }
	    };

	let response_cells_array = []

	for (const item of ids_array) {

		let temp_response = {}
    	temp_response.id_source = item.id_source

    	let fuente = sourcesDict[item.id_source];
    	const body = {
		    grid_id: grid_id,
		    levels_id: item.id_array,
		    filter_names:[],
    		filter_values:[]
	    };

		try {

	      	const response = await axios.post(fuente.url_data, body, config);
	      	// console.log(response.data)
	      	temp_response.data = response.data
	      	// console.log(temp_response)

	      	response_cells_array.push(temp_response)
	      			      
	    } 
	    catch (error) {
	      	console.error(`❌ Error enviando a ${fuente.url_variables}:`, error.message);
	    }


	} 

	return response_cells_array       

}


async function getGridLength(grid_id){

	const config = {
	        headers: {
	            'Content-Type': 'application/json',
	        }
	    };

	let grid_length;

	try {

		const url = url_gridid+grid_id
		const response = await axios.get(url, config);

      	grid_length = response.data.n
      	// console.log("grid_length: " + grid_length)
      			      
    } 
    catch (error) {
      	console.error(`❌ Error:`, error.message);
    }

	return grid_length       

}

