Wheaty
======

JS-Git based application hosting platform

## Development Usage

The easiest way to use this is with the `wheaty` CLI tool.  To install this, simply do:

```sh
> npm install -g wheaty
```

Then when you want to test a site, just launch it by git url or path to local bare git repo.

```sh
> wheaty git://github.com/creationix/creationix.com.git
```

Then open your browser to <http://localhost:8080/> to see the site.

You override the port with the `PORT` environment variable.
The git branch can be changed with the `REF` environment variable.

If you want a custom prefix inside the repo, pass it as the second argument.

```sh
> wheaty git://github.com/creationix/blog.git www
```

## Production Usage

The `wheaty-group` tool can be used to create an instant git based PaaS.  Most the
creationix.com family of sites are running using this on a Rackspace server.

My production configs were at the time of writing:

Production Sites:

```js
var pathJoin = require('path').join;
var jsRuntime = require('wheaty-js-runtime');
module.exports = {
  port: 8002,
  user: "tim",
  group: "tim",
  cacheDir: pathJoin(__dirname, "../git"),
  sites: {
    "luvit.io": {
      url: "git@github.com:luvit/luvit.io.git",
      runtimes: { js: jsRuntime },
    },
    "tedit.creationix.com": {
      url: "git@github.com:creationix/tedit.git",
      root: "build/web",
      runtimes: { js: jsRuntime },
      ssl: true,
    },
    "creationix.com": {
      url: "git@github.com:creationix/creationix.com",
      runtimes: { js: jsRuntime },
      ssl: true,
    },
  }
};
```

Test Sites:

```js
var pathJoin = require('path').join;
var jsRuntime = require('wheaty-js-runtime');
module.exports = {
  port: 8001,
  user: "tim",
  group: "tim",
  cacheDir: pathJoin(__dirname, "../git"),
  sites: {
    "dukluv.io": {
      url: "git@github.com:creationix/dukluv.git",
      root: "www",
      runtimes: { js: jsRuntime },
    },
    "conquest.creationix.com": {
      url: "https://github.com/creationix/conquest.git",
      runtimes: { js: jsRuntime },
    },
    "exploder.creationix.com": {
      url: "https://github.com/creationix/exploder.git",
      runtimes: { js: jsRuntime },
    },
    "clone-test.creationix.com": {
      url: "https://github.com/creationix/clone-test.git",
      runtimes: { js: jsRuntime },
    },
    "creator.creationix.com": {
      url: "https://github.com/creationix/creator.git",
      root: "www",
      runtimes: { js: jsRuntime },
    },
    "desktop.creationix.com": {
      url: "https://github.com/creationix/tedit.git",
      ref: "refs/heads/minimal",
      root: "build/minimal",
      runtimes: { js: jsRuntime },
    },
  }
};
```
