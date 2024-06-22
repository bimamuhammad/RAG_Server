var express = require('express');
var mod = require('dotenv')
var router = express.Router();

mod.config()
/* GET home page. */
router.get('/', function(req, res, next) {
  console.log(`Current directoty ${process.cwd()}`)
  res.render('index', { title: 'Express' });
});

module.exports = router;
