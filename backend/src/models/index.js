'use strict';

const fs = require('fs');
const path = require('path');
const { Sequelize } = require('sequelize');
const config = require('../db/config')[process.env.NODE_ENV || 'development'];

const sequelize = new Sequelize(config.url, config);
const db = {};

fs.readdirSync(__dirname)
  .filter(f => f !== 'index.js' && f.endsWith('.js'))
  .forEach(f => {
    const model = require(path.join(__dirname, f))(sequelize, Sequelize.DataTypes);
    db[model.name] = model;
  });

Object.values(db).forEach(model => model.associate?.(db));

db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;
