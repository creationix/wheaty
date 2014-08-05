// Normalizes all forms of https? and ssh urls to git:// urls for github.

var githubUrl = new RegExp("^(?:" +
  "(?:git\\+ssh://)?git@github\\.com:|" +
  "(?:git\\+)?https?://github\\.com/|" +
  "git://github\\.com/)" +
  "(.*?)(?:\\.git)?$");

module.exports = function (url) {
  // Normalize anonymous github repos to use git://
  // TODO: merge into one Regex
  var match = url.match(githubUrl);
  if (match) return "git://github.com/" + match[1] + ".git";
  return url;
};
