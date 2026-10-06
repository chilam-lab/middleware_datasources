/**
 * Express router para la carga de colecciones de datos de ocurrencias
 * propias del usuario ("Mis datos"). Espeja la separación de v1
 * (snib-middleware/src/routes/loaddatarouter.js montado en /loaddata).
 * @type {object}
 * @const
 */
var router = require('express').Router()
var loadDataCtrl = require('../controllers/loaddata_controller')
var { requireAuthUser } = require('../middlewares/authSession')

router.route('/loadOccDataGroup')
  .post(requireAuthUser, loadDataCtrl.loadOccDataGroup)

router.route('/getProfileDataList')
  .get(requireAuthUser, loadDataCtrl.getProfileDataList)
  .post(requireAuthUser, loadDataCtrl.getProfileDataList)

router.route('/getLoadedDataById')
  .get(requireAuthUser, loadDataCtrl.getLoadedDataById)
  .post(requireAuthUser, loadDataCtrl.getLoadedDataById)

router.route('/deleteLoadedData')
  .post(requireAuthUser, loadDataCtrl.deleteLoadedData)

router.route('/getThirdPartyCells')
  .post(requireAuthUser, loadDataCtrl.getThirdPartyCells)

module.exports = router;
