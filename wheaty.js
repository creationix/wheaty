"use strict";
var pathJoin = require('path').join;
var sha1 = require('git-sha1');
var modes = require('js-git/lib/modes');
var getMime = require('simple-mime')("application/octet-stream");
var bodec = require('bodec');
var pako = require('pako');
var deflate = bodec.Binary === Buffer ? function (data) {
  if (bodec.Binary === Buffer) {
    return new Buffer(pako.deflate(new Uint8Array(data)));
  }
} : pako.deflate;

// `pathToEntry*(path) -> {mode,hash,repo}` provides the interface to the underlying js-git vfs
// `runtimes` is a hash of runtimes.  Key is name like "js" and value is function* (load, url, code)
//  the output of a runtime and handleRequest is the same, it's an array with
//    output: [statusCode, headers, body]
module.exports = function (pathToEntry, runtimes) {

  var records = {};
  return handleRequest;

  // `url` is the full request url like "/foo/bar?stuff=good"
  // `headers` is a node.js-style headers hash with lower-case keys
  // return value is [statusCode, headers, body];
  function* handleRequest(url, headers) {

    // Check the recordings to do fast hash checks for conditional requests.
    var result = false;
    var etag = headers["if-none-match"] || headers["if-range"];
    if (etag) {
      var recording = records[url];
      if (!recording) {
        result = yield* execute(url);
        recording = records[url];
      }
      outer: while (recording) {
        if (etag !== recording.headers.ETag) {
          break outer;
        }
        var keys = Object.keys(recording.paths);
        for (var i = 0, l = keys.length; i < l; ++i) {
          var path = keys[i];
          var meta = yield* pathToEntry(path);
          var actual = meta && meta.hash;
          var expected = recording.paths[path];
          if (actual !== expected) {
            break outer;
          }
        }
        return [304, recording.headers];
      }
    }

    if (result === false) result = yield* execute(url);

    if (!result) return;

    var responseHeaders = result[1];
    var responseBody = result[2];
    if (result[0] === 200 && bodec.isBinary(responseBody)) {

      // Auto deflate text files if request accepts it.
      if (responseBody.length > 100 &&
          /\b(?:text|javascript)\b/.test(responseHeaders["Content-Type"]) &&
          /\bdeflate\b/.test(headers["accept-encoding"])) {
        responseBody = result[2] = deflate(responseBody);
        responseHeaders["Content-Encoding"] = "deflate";
      }

      // Auto-add Content-Length header for response bodies.
      if (!responseHeaders["Content-Length"]) {
        responseHeaders["Content-Length"] = responseBody.length;
      }
    }

    return result;
  }

  function* execute(url) {
    var recording = {
      paths: {},
      headers: {}
    };

    var result = yield* render(pathToEntryRecorded, url, runtimes);

    if (!result) return;

    if (typeof result[2] === "string") {
      result[2] = bodec.fromUnicode(result[2]);
    }
    if (!result[1].ETag && bodec.isBinary(result[2])) {
      result[1].ETag = '"' + sha1(result[2]) + '"';
    }
    recording.headers = result[1];
    records[url] = recording;

    return result;

    function* pathToEntryRecorded(path) {
      var meta = yield* pathToEntry(path);
      if (meta) recording.paths[path] = meta.hash;
      return meta;
    }
  }
};

function* render(pathToEntry, url, runtimes) {

  // Strip of query string from url to get pathname.
  var index = url.indexOf("?");
  var pathname = index >= 0 ? url.substring(0, index) : url;

  var meta = yield* pathToEntry(pathname);
  if (!meta) return;
  var repo = meta.repo;

  if (meta.mode === modes.sym) {
    var target = yield repo.loadAs("blob", meta.hash);
    target = bodec.toUnicode(target);
    if (target[0] === ".") target = pathJoin(url, "..", target);
    return yield* render(pathToEntry, target, runtimes);
  }

  // Special rules for tree requests.
  if (meta.mode === modes.tree) {
    // Make sure requests for trees end in trailing slashes.
    if (pathname[pathname.length - 1] !== "/") {
      return [301, { Location: pathname + "/" }];
    }
    // Load the actual tree listing, this should be cached by mem-cache.
    var tree = yield repo.loadAs("tree", meta.hash);
    // Look for a index file
    if (tree["index.html"] && modes.isFile(tree["index.html"].mode)) {
      meta = tree["index.html"];
      meta.repo = repo;
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

  if (modes.isFile(meta.mode)) {
    var body = yield meta.repo.loadAs("blob", meta.hash);

    if (meta.mode === modes.exec) {
      // #! but not #!/
      if (body[0] === 0x23 && body[1] === 0x21 && body[2] !== 0x2f) {
        var i = 2;
        var language = "";
        while (i < body.length && body[i] !== 0x0d && body[i] !== 0x0a) {
          language += String.fromCharCode(body[i++]);
        }
        var runtime = runtimes[language];
        if (!runtime) {
          throw new Error("Invalid runtime specified: " + JSON.stringify(language));
        }
        body = bodec.slice(body, i);
        if (runtime.constructor === Function) {
          return runtime(pathToEntry, url, body);
        }
        return yield* runtime(pathToEntry, url, body);
      }
    }

    // Render static files.
    return [200, {
      "ETag": '"' + meta.hash + '"',
      "Content-Type": getMime(url),
    }, body];
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
