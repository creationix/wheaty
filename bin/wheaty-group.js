#!/usr/local/bin/node --harmony
"use strict";

var wheaty = require('../wheaty');

var modes = require('js-git/lib/modes');
var bodec = require('bodec');
var http = require('http');
var pathJoin = require('pathjoin');
var run = require('gen-run');
var sha1 = require('git-sha1');
var tcp = require('js-git/net/tcp-node');
var tcpTransport = require('js-git/net/transport-tcp')(tcp);
var fetchPackProtocol = require('js-git/net/git-fetch-pack');
var consume = require('culvert/consume');
var configCodec = require('js-git/lib/config-codec');
var pathResolve = require('path').resolve;

var sitesConfig = require(pathResolve(process.cwd(), process.argv[2]));

var queues = {};
var repos = {};

var defaultPorts = {
  git: 9418,
  http: 80,
  https: 443
};

function* getRepo(url, ref) {

  ref = ref || "refs/heads/master";

  // Normalize github urls
  var match = url.match(/^git@github\.com:(.*?)(?:\.git)?$/) ||
              url.match(/^https:\/\/github\.com\/(.*?)(?:\.git)?$/) ||
              url.match(/^git\+ssh:\/\/git@github\.com:(.*?)(?:\.git)?$/) ||
              url.match(/^git\+https:\/\/github\.com\/(.*?)(?:\.git)?$/);
  if (match) url = "git://github.com/" + match[1] + ".git";

  // If this repo is already doing something, wait for it.
  while (url in queues) yield wait;
  function wait(callback) {
    queues[url].push(callback);
  }

  var repo = repos[url];
  if (repo) return repo;

  // Tell others we're working with it and they should wait for us.
  if (!queues[url]) queues[url] = [];

  repo = repos[url] = {};
  if (url[0] === "/") {
    require('git-node-fs/mixins/fs-db')(repo, url);
  }
  else {
    var path = pathJoin(sitesConfig.cacheDir, sha1(url) + "-" + url.match(/[^\/]+$/)[0]);
    require('git-node-fs/mixins/fs-db')(repo, path);
  }
  match = url.match(/^(https?|git):\/\/(?:([^@:]+)(?:([^@]+))?@)?([^\/:]+)(:[0-9]+)?(\/[^?]*)$/);
  if (match) {
    var protocol = match[1];
    var domain = match[4];
    var port = match[5] || defaultPorts[match[1]];
    var name = match[6];
    if (protocol !== "git") {
      throw new Error("Only git:// and local files supported for now");
    }
    repo.transport = tcpTransport(name, domain, port);
    require('js-git/mixins/pack-ops')(repo);
  }
  require('js-git/mixins/path-to-entry')(repo);
  require('js-git/mixins/mem-cache')(repo);
  require('js-git/mixins/formats')(repo);

  var head = yield repo.readRef(ref);

  if (!repo.transport) {
    if (!head) {
      throw new Error("No such ref in local repo " + url + "#" + ref);
    }
  }
  else {
    if (!head) {
      console.log("Shallow clone %s at %s", url, ref);
      yield repo.init(ref);
    }
    var api = fetchPackProtocol(repo.transport);
    var refs = yield api.take;
    if (!(ref in refs)) {
      throw new Error("No such ref in remote: " + ref);
    }
    if (refs[ref] === head) {
      api.put(null);
      api.put();
    }
    else {
      api.put({want: refs[ref]});
      api.put({deepen: 1});
      api.put(null);
      api.put({done: true});
      api.put();

      var channels = yield api.take;
      yield [
        repo.unpack(channels.pack, { onProgress: write }),
        consume(channels.progress, write),
      ];
      yield repo.updateRef(ref, refs[ref]);
      yield repo.setShallow(refs[ref]);
    }
  }

  var queue = queues[url];
  delete queues[url];
  if (queue) {
    for (var i = 0, l = queue.length; i < l; i++) {
      queue[i]();
    }
  }

  return repo;

}

var sites = {};

function makePathToEntry(baseRepo, baseRef, prefix) {
  baseRef = baseRef || "refs/heads/master";
  if (prefix) return function* (path) {
    return yield* pathToEntry(prefix + "/" + path);
  };
  return pathToEntry;
  function* pathToEntry(path) {
    path = path.split("/").filter(Boolean).join("/");
    var repo = baseRepo;
    var ref = baseRef;
    var base = "";
    while (true) {
      var hash = yield repo.readRef(ref);
      if (!hash) throw new Error("Missing ref " + ref);
      var commit = yield repo.loadAs("commit", hash);
      var root = commit.tree;
      var meta = yield repo.pathToEntry(root, path);

      if (!meta) return;
      // If the path was a file or tree, attach the repo and return it.
      if (meta.mode === modes.tree || modes.isFile(meta.mode)) {
        meta.repo = repo;
        return meta;
      }
      // Normalize partial paths and final paths
      var subPath = path;
      var subRest = "";
      if (meta.last) {
        meta = meta.last;
        subPath = meta.path;
        subRest = meta.rest;
      }

      if (meta.mode === modes.sym) {
        var target = bodec.toUnicode(yield repo.loadAs("blob", meta.hash));
        target = pathJoin(base, subPath, '..', target, subRest);
        return yield* pathToEntry(target);
      }

      // Check for .gitmodules file
      meta = yield repo.pathToEntry(root, ".gitmodules");
      if (!(meta && modes.isFile(meta.mode))) {
        throw new Error("Missing .gitmodules file");
      }

      // Load and parse the .gitmodules file.
      // TODO: cache this in memory by path and hash
      var config = configCodec.decode(bodec.toUnicode(yield repo.loadAs("blob", meta.hash)));
      config = config.submodule[subPath];
      if (!config) {
        throw new Error("Missing .gitmodules entry for " + subPath);
      }

      // Iterate the search loop with the new repo and path.
      ref = config.ref || "refs/heads/master";
      repo = yield* getRepo(config.url, ref);
      base = subPath;
      path = subRest;
    }
  }
}

var server = http.createServer(function (req, res) {
  run(function* () {
    var host = req.headers.host;
    if (!host) return;
    host = host.split(":")[0];
    var handler = sites[host];
    if (!handler) {
      var config = sitesConfig.sites[host];
      if (!config) return;
      var repo = yield* getRepo(config.url, config.ref);
      handler = sites[host] = wheaty(makePathToEntry(repo, config.ref, config.root), config.runtimes);
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

function write(message) {
  process.stdout.write(message);
}