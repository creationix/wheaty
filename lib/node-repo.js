var tcp = require('js-git/net/tcp-node');
var tcpTransport = require('js-git/net/transport-tcp')(tcp);
var pathJoin = require('path').join;
var pathResolve = require('path').resolve;

var defaultPorts = {
  git: 9418,
  http: 80,
  https: 443
};

module.exports = function (cacheDir) {
  return function createRepo(url, callback) {
    if (!callback) return createRepo.bind(null, url);
    var repo = { url: url };
    if (/:\/\//.test(url)) {
      console.log("Creating proxy repo with origin of " + url);
      var repoName = url.replace(/[:\/]+/g, ":");
      // Remote repo, store in local cache and add remote transport.
      require('git-node-fs/mixins/fs-db')(repo, pathJoin(cacheDir, repoName));
      require('js-git/mixins/pack-ops')(repo);
      var match = url.match(/^(https?|git):\/\/(?:([^@:]+)(?:([^@]+))?@)?([^\/:]+)(:[0-9]+)?(\/[^?]*)$/);
      var protocol = match[1];
      var username = match[2];
      var password = match[3];
      var domain = match[4];
      var port = match[5] || defaultPorts[match[1]];
      var pathname = match[6];
      if (protocol !== "git") {
        throw new Error("Sorry, only git:// protocol is supported at this time");
      }
      repo.origin = tcpTransport(pathname, domain, port)
    }
    else {
      var path = pathResolve(process.cwd(), url);
      console.log("Mounting local repo " + path);
      // If it's a local bare repo, mount it directly.
      require('git-node-fs/mixins/fs-db')(repo, path);
    }
    require('js-git/mixins/path-to-entry')(repo);
    require('js-git/mixins/mem-cache')(repo);
    require('js-git/mixins/formats')(repo);

    return callback(null, repo);
  };
};
