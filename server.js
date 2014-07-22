var repo = {};
require('git-node-fs/mixins/fs-db')(repo, process.argv[2]);

console.log(repo);
