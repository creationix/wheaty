var repoFarm = require('./repo-farm');
var nodeRepo = require('./node-repo');
var normalizeUrl = require('./normalize-url');
var modes = require('js-git/lib/modes');
var pathJoin = require('path').join;
var configCodec = require('js-git/lib/config-codec');


module.exports = makePathToEntry;

var queues = {};
var repos = {};

function* makePathToEntry(baseUrl, baseRef, cacheDir) {
  if (!cacheDir) throw new Error("cacheDir is required");
  var getRepo = repoFarm(normalizeUrl, nodeRepo(cacheDir));

  baseRef = baseRef || "refs/heads/master";

  return pathToEntry;

  function* pathToEntry(path) {
    path = path.split("/").filter(Boolean).join("/");
    var repo = yield getRepo(baseUrl, baseRef);
    var ref = baseRef;
    var base = "";
    var commitHash;
    while (true) {
      if (!commitHash) {
        commitHash = yield repo.readRef(ref);
      }
      if (!commitHash) throw new Error("Missing ref " + ref);
      var commit = yield repo.loadAs("commit", commitHash);
      if (!commit) {
        throw new Error("No such commit: " + commitHash);
      }
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
        var target = yield repo.loadAs("text", meta.hash);
        target = pathJoin(base, subPath, '..', target, subRest);
        return yield* pathToEntry(target);
      }

      // Check for .gitmodules file
      var modMeta = yield repo.pathToEntry(root, ".gitmodules");
      if (!(modMeta && modes.isFile(modMeta.mode))) {
        throw new Error("Missing .gitmodules file");
      }

      // Load and parse the .gitmodules file.
      // TODO: cache this in memory by path and hash
      var config = configCodec.decode(yield repo.loadAs("text", modMeta.hash));
      config = config.submodule[subPath];
      if (!config) {
        throw new Error("Missing .gitmodules entry for " + subPath);
      }

      // Iterate the search loop with the new repo and path.
      ref = config.ref || "refs/heads/master";
      repo = yield getRepo(config.url, ref);
      commitHash = meta.hash;
      base = subPath;
      path = subRest;
    }
  }
}

function write(message) {
  process.stdout.write(message);
}
