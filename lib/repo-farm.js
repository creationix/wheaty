"use strict";
var pathJoin = require('path').join;
var oneShot = require('./one-shot');
var fetch = require('./fetch');
var defer = require('js-git/lib/defer');

/*

if hash ref and local repo found and hash seen -> done

GET LOCK

if not local repo then create one

if hash ref
  if found locally (mark seen) -> done
  fetch and then (mark seen) -> done

if symbolic ref
  if not seen before read local ref
    if not found fetch/clone

    (if remote and > 10000 since fetch, schedule background fetch)
  if timeout < 1000 -> done
  read local ref and then -> done

done: RELEASE LOCK
return hash

url: {
  concrete hash: true if seen before
  symbolic ref: {
    hash: hash of symbolic ref last read
    rtime: last time symref was read from disk
    ftime: last time fetch was done against remote
  }
}
*/


module.exports = function (normalizeUrl, createRepo) {

  var repos = {};
  var locks = {};

  return getRepo;
  // Url is path to local bare git repo or url or remote
  // ref is full ref path like "refs/heads/master" or "refs/current" for tedit state.
  // or it can be a specefic sha1 hash (usually used for submodules)
  function getRepo(url, ref, callback) {
    if (!callback) return getRepo.bind(null, url, ref);
    done = oneShot(done);
    url = normalizeUrl(url);
    ref = ref || "refs/heads/master";
    // Detect if the ref is an absolute hash or a symbolic ref
    var repo = repos[url];  // handle to repo instance
    var isHash = /^[0-9a-f]{40}$/.test(ref);
    var hash; // Variable to hold result.
    var now, meta;

    // Short circuit for cached submodules
    // Everything is immutable at this point, so no lock is needed.
    if (isHash && repo && repo[ref]) {
      return done(null, ref);
    }

    return getLock(url, run);

    function run() {
      // First make sure we have a repo instance locally
      if (!repo) return createRepo(url, onRepo);
      // For simple hash requests, check if we have it already
      if (isHash) return repo.hasHash(ref, onHas);
      // For symbolic ref requests, we need to consule the memory
      now = Date.now();
      meta = repo[ref] || (repo[ref] = {
        hash: null, // Cached ref value
        rtime: 0,   // Timestamp for last ref read from disk
        ftime: 0,   // Timestamp for last fetch from remote
      });
      if (meta.hash && now - meta.rtime < 1000) {
        return done(null, meta.hash);
      }
      return repo.readRef(ref, onRef);
    }

    function onRepo(err, result) {
      if (err) return done(err);
      repo = repos[url] = result;
      return run();
    }

    function onHas(err, hasHash) {
      if (err) return done(err);
      // If we did have it, mark this fact for fast path later on and be done.
      if (hasHash) {
        repo[ref] = true;
        return done(null, ref);
      }
      if (!repo.origin) {
        // If there is no remote, we're stuck and must give up.
        return done(new Error("No such hash in local repo " + ref));
      }
      // Try to fetch the hash.
      return fetch(repo, ref, null, onHashFetch);
    }

    function onHashFetch(err, result) {
      if (!result) return done(err || new Error("No such hash locally or in remote " + ref));
      // If it was fetched, we're good to go forever on this hash.
      repo[ref] = true;
      return done(null, ref);
    }

    function onRef(err, result) {
      if (err) return done(err);
      if (result) {
        // If a hash is found locally, serve it up
        meta.hash = result;
        meta.rtime = now;
        // But make sure to schedule a background update if it's been a while.
        if (repo.origin && now - meta.ftime > 10000) backgroundFetch();
        return done(null, result);
      }
      // If the ref doesn't exist locally, we need to wait on fetch.
      if (!result) return fetch(repo, ref, null, onRefFetch);
    }

    function onRefFetch(err, result) {
      if (!result) return done(err || new Error("No such ref locally or in remote " + ref));
      onUpdate(null, result);
      return done(null, result);
    }

    function backgroundFetch() {
      // Mark ftime so we don't start another fetch while this is running.
      meta.ftime = now;
      // Defer so it can't interfere with the current stack.
      defer(function () {
        fetch(repo, ref, meta.hash, onUpdate);
      });
    }

    function onUpdate(err, result) {
      if (err) return console.error(err.stack);
      if (result) {
        now = Date.now();
        meta.hash = result;
        meta.rtime = now;
        meta.ftime = now;
      }
    }

    function done(err, hash) {
      releaseLock(url);
      if (err) return callback(err);
      // console.log(url, ref, hash);
      return callback(null, repo, hash);
    }

  }

  function getLock(url, callback) {
    var queue = locks[url];
    if (!queue) {
      locks[url] = [];
      return callback();
    }
    queue.push(callback);
  }

  function releaseLock(url) {
    var queue = locks[url];
    if (!queue) return;
    var callback = queue.shift();
    if (!queue.length) delete locks[url];
    if (callback) callback();
  }

};

