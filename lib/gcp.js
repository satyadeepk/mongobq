var util = require('util');
var path = require('path');
var _ = require('underscore');
var gcloud = require('gcloud');
var moment = require('moment');

function GCP(opts) {
  this.projectSettings = {
    projectId: opts.project
  };

  if (opts.keyfile) {
    this.projectSettings.keyFilename = opts.keyfile;
  }
}

GCP.safeName = function (name) {
  var n = name.replace(/\W/, '_').toLowerCase();
  if (n.charAt(0) === '_') {
    n = n.substr(1);
  }
  return n;
};

GCP.prototype.storageFile = function (opts) {
  return new GCSFile(this.projectSettings, opts);
};

GCP.prototype.bigqueryTable = function (opts) {
  return new BigQueryTable(this.projectSettings, opts);
};

module.exports = GCP;

// Google Cloud Storage

function GCSFile(projectSettings, opts) {
  this.projectSettings = projectSettings;
  this.bucketName = opts.bucket;
  this.path = opts.path;
}

GCSFile.prototype.storage = function () {
  return gcloud.storage(this.projectSettings);
};

GCSFile.prototype.bucket = function () {
  return this.storage().bucket(this.bucketName);
};

GCSFile.prototype.file = function () {
  return this.bucket().file(this.path);
};

GCSFile.prototype.createWriteStream = function () {
  return this.file().createWriteStream();
};

GCSFile.prototype.fullPath = function () {
  return util.format("gs://%s", path.join(this.bucketName, this.path));
};

GCSFile.prototype.exists = function (callback) {
  this.file().getMetadata(function(err) {
    if (err && err.code === 404) {
      callback(null, false);
    } else if (err) {
      callback(err);
    } else {
      callback(null, true);
    }
  });
};

GCSFile.prototype.createBucket = function (callback) {
  var self = this;
  self.bucket().getMetadata(function(err) {
    if (err && err.code === 404) {
      self.storage().createBucket(self.bucketName, function (err, bucket) {
        callback(err, true);
      });
    } else if (err) {
      process.nextTick(function () {
        callback(err);
      });
    } else {
      process.nextTick(function () {
        callback(null, false);
      });
    }
  });
};

GCSFile.prototype.clean = function (callback) {
  this.file().delete(callback);
};

// Google BigQuery

function BigQueryTable(projectSettings, opts) {
  this.projectSettings = projectSettings;
  this.datasetId = opts.dataset;
  this.tableId = opts.table;
}

BigQueryTable.prototype.bq = function () {
  return gcloud.bigquery(this.projectSettings);
};

BigQueryTable.prototype.dataset = function () {
  return this.bq().dataset(this.datasetId);
};

BigQueryTable.prototype.table = function () {
  return this.dataset().table(this.tableId);
};

BigQueryTable.prototype.fullName = function () {
  return util.format("%s:%s.%s", this.projectSettings.projectId, this.datasetId, this.tableId);
};

/**
 * Currently not support RECORD object
 */
BigQueryTable.prototype.value = function (v) {
  if (v === null) {
    return null;
  } else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
    return v;
  } else if (util.isDate(v)) {
    return moment(v).utc().format('YYYY-MM-DD HH:mm:ss');
  } else if (util.isArray(v)) {
    return v;
  } else {
    return JSON.stringify(v);
  }
};

/**
 * Currently not support RECORD object
 */
BigQueryTable.prototype.type = function (k, v, timeFields) {
  if (_.include(timeFields, k) || util.isDate(v)) {
    return 'TIMESTAMP';
  } else if (typeof v === 'number') {
    if (v === +v && v === (v|0)) {
      return 'INTEGER';
    }
    return 'FLOAT';
  } else if (typeof v === 'boolean') {
    return 'BOOLEAN';
  } else if (util.isArray(v) && v[0]) {
    return this.type(k, v[0], timeFields);
  }
  return 'STRING';
};

BigQueryTable.prototype.mode = function (v) {
  if (util.isArray(v)) {
    return 'REPEATED';
  } else {
    return 'NULLABLE';
  }
};

BigQueryTable.prototype.column = function (k, v, timeFields) {
  return {
    name: GCP.safeName(k),
    type: this.type(k, v, timeFields),
    mode: this.mode(v)
  };
};

BigQueryTable.prototype.metadata = function (callback) {
  this.table().getMetadata(callback);
};

BigQueryTable.prototype.load = function (file, schema, config, callback) {
  var schemaArray = [];
  var keys = Object.keys(schema);
  keys.sort(function(a, b) {
    if (a === 'id') {
      return -1;
    } else if (b === 'id') {
      return 1;
    } else {
      return a.localeCompare(b);
    }
  });
  keys.forEach(function (key) {
    schemaArray.push(schema[key]);
  });

  config.schema = {};
  config.schema['fields'] = schemaArray;

  console.log("=== Load config ===");
  console.log(JSON.stringify(config, null, '  '));
  console.log("===================");
  console.log();

  this.table().import(file.file(), config, callback);
};