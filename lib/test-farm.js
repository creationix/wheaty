var getRepo = require('./repo-farm')(
  require('./normalize-url'),
  require('./node-repo')((process.env.HOME + "/.git-cache"))
);

require('gen-run')(function* () {
  var repos = yield {
    tedit: getRepo("git@github.com:creationix/tedit"),
    desktop: getRepo("git://github.com/creationix/tedit.git", "refs/heads/minimal"),
    "git-sha1": getRepo("https://github.com/creationix/git-sha1.git"),
    "pako": getRepo("https://github.com/nodeca/pako.git"),
  };
  console.log(repos);
  while (true) {
    yield function (callback) {
      setTimeout(callback, 500);
    }
    repo = yield getRepo("git@github.com:creationix/test");
  }
});


