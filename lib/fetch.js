"use strict";

var oneShot = require('./one-shot');
var fetchPackProtocol = require('js-git/net/git-fetch-pack');
var consume = require('culvert/consume');
module.exports = fetch;

function fetch(repo, ref, hash, callback) {
  if (!callback) return fetch.bind(null, repo, ref, hash);
  console.log(repo.url, ref, hash);
  var isHash = /^[0-9a-f]{40}$/.test(ref);
  var api, refs, left;
  callback = callback ? oneShot(callback) : noop;

  api = fetchPackProtocol(repo.origin, callback);
  if (repo.init) repo.init(ref, onInit);
  else onInit();

  function onInit(err) {
    if (err) return callback(err);
    api.take(onRefs);
  }

  function onRefs(err, result) {
    if (!result) return callback(err || new Error("Error reading remote refs"));
    refs = result;
    if (!refs[ref]) {
      return callback(new Error("No such ref in remote: " + repo.url + "#" + ref));
    }
    if (refs[ref] === hash) {
      api.put(null);
      api.put();
      console.log("no change", repo.url + "#" + ref);
      return callback(null, refs[ref]);
    }
    if (isHash) {
      // Check if the hash happens to be a branch head or tag
      var hasHash = false;
      Object.keys(refs).forEach(function (name) {
        if (refs[name] === ref) hasHash = true;
      })
      if (hasHash) {
        // If so, ask for just that one.
        api.put({want: ref});
      }
      else {
        // Otherwise, grab everything since we don't know.
        Object.keys(refs).forEach(function (name) {
          api.put({want: refs[name]});
        })
      }
    }
    else if (!refs[ref]) return callback();
    else api.put({want: refs[ref]});
    api.put(null);
    // If this is just an incremental update, tell the remote what we last saw.
    if (hash) {
      api.put({have: hash});
    }
    api.put({done: true});
    api.put();
    api.take(onChannels);
  }

  function onChannels(err, channels) {
    if (!channels) return callback(err || new Error("Error getting remote pack stream"));
    repo.unpack(channels.pack, { onProgress: onProgress }, onUnpacked);
    consume(channels.progress, onProgress, onConsumed);
  }

  function onConsumed(err) {
    if (err) return callback(err);
  }

  function onUnpacked(err, report) {
    if (err) return callback(err);
    repo.updateRef(ref, refs[ref], onUpdated);
  }

  function onUpdated(err) {
    if (err) return callback(err);
    callback(null, refs[ref]);
  }

};

function onProgress(message) {
  process.stdout.write(message);
}

function noop(err) {
  if (err) console.error(err.stack);
}