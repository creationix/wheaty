"use strict";
var http = require('http');
var pathResolve = require('path').resolve;
var wheaty = require('../wheaty');
var run = require('gen-run');

// Create a js-git instance by mounting a local git repo from disk
var repo = {};
require('git-node-fs/mixins/fs-db')(repo, pathResolve(process.cwd(), process.argv[2]));
require('js-git/mixins/path-to-entry')(repo);
require('js-git/mixins/read-combiner')(repo);
require('js-git/mixins/mem-cache')(repo);
require('js-git/mixins/formats')(repo);

function* pathToEntry(url) {
  var head = yield repo.readRef("refs/heads/master");
  var commit = yield repo.loadAs("commit", head);
  var root = commit.tree;
  var meta = yield repo.pathToEntry(root, url);
  if (meta) meta.repo = repo;
  console.log(url, meta);
  return meta;
}

var runtimes ={
  jackl: require('./runtimes/jackl'),
  js: require('./runtimes/js'),
};

var handleRequest = wheaty(pathToEntry, runtimes);

var server = http.createServer(function (req, res) {
  run(handleRequest(req.url, req.headers), function (err, result) {
    if (err) result = [500, {}, err.stack + "\n"];
    else if (!result) result = [404, {}, "Not found: " + req.url + "\n"];
    console.log(req.method, req.url, result[0]);
    res.writeHead(result[0], result[1]);
    res.end(result[2]);
  });
});

server.listen(8080, function () {
  console.log("Wheaty server listening at http://localhost:8080/");
});
