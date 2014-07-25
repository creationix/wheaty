#!/usr/local/bin/node --harmony
"use strict";

var wheaty = require('../wheaty');
var http = require('http');
var run = require('gen-run');
var pathResolve = require('path').resolve;
var makePathToEntry = require('../lib/node-vfs');

var sitesConfig = require(pathResolve(process.cwd(), process.argv[2]));

if (!process.getuid()) {
  if (sitesConfig.group) {
    console.log("Changing group to", sitesConfig.group);
    process.setgid(sitesConfig.group);
  }
  if (sitesConfig.user) {
    console.log("Changing user to", sitesConfig.user);
    process.setuid(sitesConfig.user);
  }
}

var sites = {};

var server = http.createServer(function (req, res) {
  run(function* () {
    var host = req.headers.host;
    if (!host) return;
    host = host.split(":")[0];
    var handler = sites[host];
    if (!handler) {
      var config = sitesConfig.sites[host];
      if (!config) return;
      handler = sites[host] = wheaty(yield* makePathToEntry(config.url, config.ref, config.root, sitesConfig.cacheDir), config.runtimes);
    }
    return yield* handler(req.url, req.headers);
  }, function (err, result) {
    if (err) result = [500, {}, err.stack + "\n"];
    else if (!result) result = [404, {}, "Not found: " + req.url + "\n"];
    console.log(req.method, req.headers.host, req.url, result[0]);
    res.writeHead(result[0], result[1]);
    res.end(result[2]);
  });
});


server.listen(sitesConfig.port, "127.0.0.1", function () {
  console.log("Wheaty server listening at http://127.0.0.1:%s/", server.address().port);
  Object.keys(sitesConfig.sites).forEach(function (name) {
    var config = sitesConfig.sites[name];
    console.log("http" + (config.ssl ? "s" : "") + "://" + name + " - " + config.url);
  });
});
