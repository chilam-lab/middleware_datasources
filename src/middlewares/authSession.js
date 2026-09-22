var debug = require('debug')('verbs:authSession')
const axios = require('axios');
const config = require('../../config');

/**
 * Valida un sessionid contra auth_backend (POST /auth/isAuth) y regresa el
 * usuario autenticado ({userid, name, email, ...}), o null si la sesión no
 * existe/expiró. Nunca confía en un userid mandado por el cliente.
 */
async function verifySession(sessionid) {
  if (!sessionid) return null;

  try {
    const { data } = await axios.post(`${config.authBaseUrl}/isAuth`, { sessionid });

    if (data && data.status === 0 && Array.isArray(data.session) && data.session[0]) {
      const user = data.session[0].sess && data.session[0].sess.user;
      return user || null;
    }

    return null;
  } catch (error) {
    debug('verifySession error: ' + (error.message || error));
    return null;
  }
}

/**
 * Uso opcional: si viene un sessionid válido en el body, adjunta req.authUser.
 * Si no viene o no es válido, req.authUser queda en null y la petición sigue
 * (para no romper flujos anónimos ya existentes, ej. análisis sin login).
 */
async function attachAuthUser(req, res, next) {
  const sessionid = req.body && req.body.sessionid;
  req.authUser = await verifySession(sessionid);
  next();
}

/**
 * Uso obligatorio: sin sessionid válido, responde 401 de inmediato.
 */
async function requireAuthUser(req, res, next) {
  const sessionid = req.body && req.body.sessionid;
  const user = await verifySession(sessionid);

  if (!user) {
    return res.status(401).json({ status: 1, message: 'Sesión inválida o expirada' });
  }

  req.authUser = user;
  next();
}

module.exports = { verifySession, attachAuthUser, requireAuthUser };
