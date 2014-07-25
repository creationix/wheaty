"use strict";
var modes = require('js-git/lib/modes');
var bodec = require('bodec');
var http = require('http');
var wheaty = require('../wheaty');
var jsRuntime = require('wheaty-js-runtime');
var pathJoin = require('pathjoin');
var run = require('gen-run');
var sha1 = require('git-sha1');
var tcp = require('js-git/net/tcp-node');
var tcpTransport = require('js-git/net/transport-tcp')(tcp);
var fetchPackProtocol = require('js-git/net/git-fetch-pack');
var consume = require('culvert/consume');
var configCodec = require('js-git/lib/config-codec');

var repoDir = pathJoin(__dirname, "../../git");

var sitesConfig = {
  "conquest.localhost:8000": {
    url: "https://github.com/creationix/conquest.git",
    runtimes: { js: jsRuntime },
  },
  "exploder.localhost:8000": {
    url: "https://github.com/creationix/exploder.git",
    runtimes: { js: jsRuntime },
  },
  "luvit.localhost:8000": {
    url: "git@github.com:luvit/luvit.io.git",
    runtimes: { js: jsRuntime },
  },
};

var queues = {};
var repos = {};

var defaultPorts = {
  git: 9418,
  http: 80,
  https: 443
};

function* getRepo(url) {

  // Extract the ref
  var ref = "refs/heads/master";
  var index = url.indexOf("#");
  if (index >= 0) {
    ref = url.substring(index + 1);
    url = url.substring(0, index);
  }

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

  // Tell others we're working with it and they should wait for us.
  if (!queues[url]) queues[url] = [];

  var repo = repos[url];
  if (!repo) {
    repo = repos[url] = {};
    if (url[0] === "/") {
      require('git-node-fs/mixins/fs-db')(repo, url);
    }
    else {
      var path = pathJoin(repoDir, sha1(url) + "-" + url.match(/[^\/]+$/)[0]);
      require('git-node-fs/mixins/fs-db')(repo, path);
    }
    var match = url.match(/^(https?|git):\/\/(?:([^@:]+)(?:([^@]+))?@)?([^\/:]+)(:[0-9]+)?(\/[^?]*)$/);
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
        yield repo.init();
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

function makePathToEntry(baseRepo, baseRef) {
  baseRef = baseRef || "refs/heads/master";
  return function* pathToEntry(path) {
    var repo = baseRepo;
    var ref = baseRef;
    var base = "";
    path = path.split("/").filter(Boolean).join("/");
    while (true) {
      var commit = yield repo.loadAs("commit", yield repo.readRef(ref));
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
  };
}

var server = http.createServer(function (req, res) {
  run(function* () {
    var host = req.headers.host;
    if (!host) return;
    var handler = sites[host];
    if (!handler) {
      var config = sitesConfig[host];
      if (!config) return;
      var repo = yield* getRepo(config.url);

      handler = sites[host] = wheaty(makePathToEntry(repo, config.ref), config.runtimes);
    }
    return yield* handler(req.url, req.headers);
  }, function (err, result) {
    if (err) result = [500, {}, err.stack + "\n"];
    else if (!result) result = [404, {}, "Not found: " + req.url + "\n"];
    console.log(req.method, req.url, result[0]);
    res.writeHead(result[0], result[1]);
    res.end(result[2]);
  });
});

server.listen(process.env.PORT || 8000, function () {
  console.log("Wheaty server listening at http://localhost:%s/", server.address().port);
});

function write(message) {
  process.stdout.write(message);
}