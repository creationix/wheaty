var pathJoin = require('pathjoin');
var jsRuntime = require('wheaty-js-runtime');

module.exports = {
  port: 8080,
  cacheDir: pathJoin(__dirname, "../../git"),
  sites: {
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
    "tedit.localhost:8000": {
      url: "git://github.com/creationix/tedit.git",
      runtimes: { js: jsRuntime },
    },
  }
};
