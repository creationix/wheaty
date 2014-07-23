"use strict";
var http = require('http');
var zlib = require('zlib');
var urlParse = require('url').parse;
var pathJoin = require('path').join;
var sha1 = require('git-sha1');
var pathResolve = require('path').resolve;
var modes = require('js-git/lib/modes');
var run = require('gen-run');
var getMime = require('simple-mime')("application/octet-stream");
var bodec = require('bodec');

var repo = {};
require('git-node-fs/mixins/fs-db')(repo, pathResolve(__dirname, process.argv[2]));
require('js-git/mixins/path-to-entry')(repo);
require('js-git/mixins/read-combiner')(repo);
require('js-git/mixins/mem-cache')(repo);
require('js-git/mixins/formats')(repo);

var server = http.createServer(function (req, res) {
  run(handleRequest(req), function (err, result) {
    if (err) {
      res.statusCode = 500;
      return res.end(err.stack);
    }
    if (!result) {
      res.statusCode = 404;
      return res.end();
    }
    console.log(result);
    res.writeHead(result[0], result[1]);
    res.end(result[2]);
  });
});

server.listen(8080, function () {
  console.log("Wheaty server listening at http://localhost:8080/");
});

var records = {};

function* handleRequest(req) {
  var head = yield repo.readRef("refs/heads/master");
  if (!head) throw new Error("Missing head in repo");
  var commit = yield repo.loadAs("commit", head);
  var root = commit.tree;

  var url = urlParse(req.url).pathname;
  var code = sha1(render.toString());
  var result = false;
  var etag = req.headers["if-none-match"] || req.headers["if-range"]
  if (etag) {
    var recording = records[url];
    if (!recording) {
      result = yield* execute(root, code, url);
      recording = records[url];
    }
    outer: while (recording) {
      if (etag !== recording.headers.ETag) {
        console.log("etag mismatch");
        break outer;
      }
      if (code !== recording.code) {
        console.log("code change");
        break outer;
      }
      for (var path in recording.paths) {
        var actual = (yield repo.pathToEntry(root, path)).hash;
        var expected = recording.paths[path];
        if (actual !== expected) {
          console.log("change in " + path + " from " + expected + " to " + actual);
          break outer;
        }
      }
      return [304, recording.headers];
    }
  }
  if (result === false) result = (yield* execute(root, code, url));
  if (result) {
    var headers = result[1];
    if (bodec.isBinary(result[2])) {
      // Auto deflate text files if request accepts it.
      if (/\b(?:text|javascript)\b/.test(headers["Content-Type"]) &&
          /\bgzip\b/.test(req.headers["accept-encoding"])) {
        result[2] = yield function (callback) {
          zlib.gzip(result[2], callback);
        };
        headers["Content-Encoding"] = "gzip";
      }

      // Auto-add Content-Length header for response bodies.
      if (!headers["Content-Length"]) {
        headers["Content-Length"] = result[2].length;
      }
    }
  }
  return result;
}

function* execute(root, code, url) {
  var recording = {
    code: code,
    paths: {},
    headers: {},
  };

  function* load(path) {
    var meta = yield repo.pathToEntry(root, path);
    recording.paths[path] = meta.hash;
    return meta;
  }
  var result = yield* render(load, url);
  if (result) {
    recording.headers = result[1];
    records[url] = recording;
  }
  return result;
}

function* render(load, url) {

  var meta = yield* load(url);

  // Special rules for tree requests.
  if (meta.mode === modes.tree) {
    // Make sure requests for trees end in trailing slashes.
    if (url[url.length - 1] !== "/") {
      return [301, { Location: url + "/" }];
    }
    // Load the actual tree listing, this should be cached by mem-cache.
    var tree = yield repo.loadAs("tree", meta.hash);
    // Look for a index file
    if (tree["index.html"] && modes.isFile(tree["index.html"].mode)) {
      meta = tree["index.html"];
      url = pathJoin(url, "index.html");
      // Fall through down to static file handler.
    }
    // Otherwise render a index file
    else {
      return [200, {
        "ETag": '"' + meta.hash + '-html"',
        "Content-Type": "text/html",
      }, bodec.fromUnicode(formatTree(tree))];
    }
  }

  if (meta.mode === modes.exec) {
    console.log(url);
    throw new Error("TODO: Impement dynamic file");
  }

  // Render static files.
  if (modes.isFile(meta.mode)) {
    return [200, {
      "ETag": '"' + meta.hash + '"',
      "Content-Type": getMime(url),
    }, yield repo.loadAs("blob", meta.hash)];
  }
}

function formatTree(tree) {
  return "<ul>\n  " + Object.keys(tree).map(function (name) {
    var escaped = name.replace(/&/g, '&amp;')
                      .replace(/"/g, '&quot;')
                      .replace(/</g, '&lt;')
                      .replace(/>/g, '&gt;');
    var entry = tree[name];
    return '<li><a href="' + escaped + '">' + escaped + "</a>" +
                " - " + entry.mode.toString(8) +
                " - " + entry.hash + "</li>";
  }).join("\n  ") + "\n</ul>\n";
}
