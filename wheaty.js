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

function getPathname(url) {
  // Strip of query string from url to get pathname.
  var index = url.indexOf("?");
  return index >= 0 ? url.substring(0, index) : url;
}

function* render(pathToEntry, url, runtimes) {

  // Strip of query string from url to get pathname.
  var pathname = getPathname(url);

  var meta = yield* pathToEntry(pathname);
  if (!meta) return;
  var repo = meta.repo;

  // Send redirects for symlinks
  if (meta.mode === modes.sym) {
    var target = yield repo.loadAs("blob", meta.hash);
    target = bodec.toUnicode(target);
    if (target[0] !== "/") target = pathJoin(url, "..", target);
    return [302, {Location: target}];
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
      }, bodec.fromUnicode(formatTree(tree, url))];
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
      "Content-Type": getMime(getPathname(url)),
    }, body];
  }
}

var escapeMap = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

function escapeHtml(string, quotes) {
  return String(string).replace(quotes ? /[&<>"]/g : /[&<>]/g, function (char) {
    return escapeMap[char];
  });
}

var typeNames = {};
typeNames[modes.commit] = "Submodule";
typeNames[modes.tree] = "Directory";
typeNames[modes.blob] = "File";
typeNames[modes.exec] = "Executable File";
typeNames[modes.sym] = "Symbolic Link";

var iconNames = {};
iconNames[modes.commit] = "icon-box";
iconNames[modes.tree] = "icon-folder-open";
iconNames[modes.blob] = "icon-doc";
iconNames[modes.exec] = "icon-cog";
iconNames[modes.sym] = "icon-link";

function formatTree(tree, path) {
  return "<!doctype html><html><head><style>\n" +
    "  @font-face {\n" +
    "    font-family: 'fontello';\n" +
    "    src: url('data:application/octet-stream;base64,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') format('woff'),\n" +
    "         url('data:application/octet-stream;base64,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') format('truetype');\n" +
    "  }\n" +
    '  [class^="icon-"]:before, [class*=" icon-"]:before {\n' +
    '    font-family: "fontello";\n' +
    "    font-style: normal;\n" +
    "    font-weight: normal;\n" +
    "    speak: none;\n" +
    "\n" +
    "    display: inline-block;\n" +
    "    text-decoration: inherit;\n" +
    "    width: 1em;\n" +
    "    margin-right: .2em;\n" +
    "    text-align: center;\n" +
    "    /* opacity: .8; */\n" +
    "\n" +
    "    /* For safety - reset parent styles, that can break glyph codes*/\n" +
    "    font-variant: normal;\n" +
    "    text-transform: none;\n" +
    "       \n" +
    "    /* fix buttons height, for twitter bootstrap */\n" +
    "    line-height: 1em;\n" +
    "\n" +
    "    /* Animation center compensation - margins should be symmetric */\n" +
    "    /* remove if not needed */\n" +
    "    margin-left: .2em;\n" +
    "\n" +
    "    /* you can be more comfortable with increased icons size */\n" +
    "    /* font-size: 120%; */\n" +
    "\n" +
    "    /* Uncomment for 3D effect */\n" +
    "    /* text-shadow: 1px 1px 1px rgba(127, 127, 127, 0.3); */\n" +
    "  }\n" +
    "  .icon-box:before { content: '\\e800'; }\n" +
    "  .icon-file-audio:before { content: '\\e801'; }\n" +
    "  .icon-file-code:before { content: '\\e802'; }\n" +
    "  .icon-file-video:before { content: '\\e803'; }\n" +
    "  .icon-doc-text:before { content: '\\e804'; }\n" +
    "  .icon-doc:before { content: '\\e805'; }\n" +
    "  .icon-file-image:before { content: '\\e806'; }\n" +
    "  .icon-file-archive:before { content: '\\e807'; }\n" +
    "  .icon-link:before { content: '\\e808'; }\n" +
    "  .icon-cog:before { content: '\\e809'; }\n" +
    "  .icon-folder-open:before { content: '\\e80a'; }\n" +
    "  body, html { background: #fdf6e3; margin: 0; }\n" +
    "  html { font: 14px/1.4 'Helvetica Neue', Helvetica, sans-serif; color: #657b83; font-weight: 400; }\n" +
    "  h2 { font-weight: 200; font-size: 45px; margin: 20px 35px; }\n" +
    "  table { background: #eee8d5; color: #586e75; padding: 20px 35px; }\n" +
    "  p { margin-top: 15px; padding: 20px 35px; }\n" +
    "  .hash { font-family: menlo, monaco, Ubuntu Mono, monospace; }\n" +
    "  td { padding: 0 20px; line-height: 21px; }\n" +
    "  a { color: #268bd2; }\n" +
    "  a:visited { color: #d33682; }\n" +
    "</style></head><body>\n" +
    "<h2>Index of " + path + "</h2>\n" +
    "<table>\n" +
    "  <thead>\n" +
    "    <tr><th>Name</th><th>Type</th><th>Git Hash</th></tr>\n" +
    "  </thead>\n" +
    "<tbody>\n" +
    "  <tbody>\n" +
    Object.keys(tree).map(function (name) {
      var entry = tree[name];
      if (entry.mode === modes.tree || entry.mode === modes.commit) name += "/";
      var icon = iconNames[entry.mode];
      if (icon === "icon-doc") {
        if (name === "LICENSE" || name === "README") {
          icon = "icon-doc-text";
        }
        else {
          var mime = getMime(name);
          if (/\bimage\b/.test(mime)) icon = "icon-file-image";
          else if (/\baudio\b/.test(mime)) icon = "icon-file-audio";
          else if (/\bvideo\b/.test(mime)) icon = "icon-file-video";
          else if (/(?:script|xml|html|source|json)/.test(mime)) icon = "icon-file-code";
          else if (/\btext\b/.test(mime)) icon = "icon-doc-text";
          else if (/zip\b/.test(mime)) icon = "icon-file-archive";
          else console.log(mime);
        }
      }
      return '    <tr>\n' +
        '      <td class="name"><i class="' + icon + '"><a href="' + escapeHtml(name, true) + '">' + escapeHtml(name) + "</a></td>\n" +
        '      <td class="mode">' + typeNames[entry.mode] + "</td>\n" +
        '      <td class="hash">' + entry.hash + "</td>\n" +
        '    </tr>\n';
    }).join("") +
    "  </tbody>\n" +
    "</table>\n" +
    '<p>Hosted from a <a href="https://github.com/creationix/js-git">JS-Git</a> instance by the <a href="https://github.com/creationix/wheaty">Wheaty Platform</a>\n' +
    "</body></html>\n";
}
