"use strict";
var bodec = require('bodec');
var mine = require('mine');
var inspect = require('util').inspect;
var ansiToHtml = require('./ansi-to-html');
var pathJoin = require('pathjoin');
var vm = require('vm');

module.exports = function* (load, url, code) {
  var loaded = {};
  var defs = {};
  var modules = {};
  code = bodec.toUnicode(code);
  yield* prep(url, code);
  var out = globalRequire(url);
  if (typeof out === "function") {
    if (/^function\s*\*/.test(out.toString())) {
      console.log("generator export");
      return yield* out(load, url);
    }
    console.log("continuable export")
    return yield out(load, url);
  }
  console.log("object export");
  return out;

  function globalRequire(url) {
    if (url in modules) return modules[url].exports;
    var exports = {};
    var module = modules[url] = { exports: exports };
    var dirname = pathJoin(url, "..");
    var sandbox = {
      console: console,
      require: localRequire,
      module: module,
      exports: exports,
      __dirname: dirname,
      __filename: url
    };
    defs[url].runInNewContext(sandbox);
    // if (ret !== undefined) module.exports = ret;
    return sandbox.module.exports;

    function localRequire(path) {
      if (path[0] === ".") {
        path = pathJoin(dirname, path);
        if (!/\.js$/.test(path)) path += ".js";
        return globalRequire(path);
      }
      return require(path);
    }
  }

  function* prep(url, code) {
    if (loaded[url]) return;
    loaded[url] = true;
    if (!code) {
      var meta = yield* load(url);
      if (!meta) {
        throw new Error("No such module: " + url);
      }
      code = yield meta.repo.loadAs("blob", meta.hash);
      code = bodec.toUnicode(code);
    }

    defs[url] = vm.createScript(code, "vfs:/" + url);
    var deps = mine(code);
    for (var i = 0, l = deps.length; i < l; i++) {
      var name = deps[i].name;
      if (name[0] !== ".") continue;
      var dep = pathJoin(url, "..", name);
      if (!/\.js$/.test(dep)) dep += ".js";
      yield* prep(dep);
    }
  }

};
