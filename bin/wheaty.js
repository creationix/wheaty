#!/usr/local/bin/node --harmony
"use strict";

var wheaty = require('../wheaty');
var http = require('http');
var run = require('gen-run');
var pathResolve = require('path').resolve;
var makePathToEntry = require('repo-farm/node-vfs');
var wheatyVersion = require('../package.json').version;

var url = process.argv[2];
if (!/(?:@|:\/\/)/.test(url)) {
  url = pathResolve(process.cwd(), url);
}
var ref = process.argv[3] || "refs/heads/master";
var port = process.env.PORT || 8080;
var cacheDir = process.env.HOME + "/.gitCache";
var runtimes = { js: require('wheaty-js-runtime') };

var handler;

var server = http.createServer(function (req, res) {
  run(function* () {
    if (!handler) {
      var pathToEntry = yield* makePathToEntry(url, ref, cacheDir);
      handler = wheaty(pathToEntry, runtimes);
    }
    return yield* handler(req.url, req.headers);
  }, function (err, result) {
    if (err) result = [500, {}, err.stack + "\n"];
    else if (!result) result = [404, {}, "Not found: " + req.url + "\n"];
    console.log(req.method, req.headers.host, req.url, result[0]);
    result[1]["X-Wheaty-Version"] = wheatyVersion;
    res.writeHead(result[0], result[1]);
    res.end(result[2]);
  });
});

server.listen(port, function () {
  console.log("Wheaty server listening at http://localhost:%s/", server.address().port);
});
