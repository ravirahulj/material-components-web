const parser = require('conventional-commits-parser');
const parserOpts = require('conventional-changelog-angular/parser-opts');
const simpleGit = require('simple-git/promise')();

async function getMostRecentTag() {
  const tags = await simpleGit.tags();
  // Filter old independent-versioned tags and pre-releases
  const filteredTags = tags.all.filter((tag) => /^v/.test(tag) && !/-/.test(tag));
  return filteredTags[filteredTags.length - 1];
}

async function getCommitsAfterTag(tag) {
  const log = await simpleGit.log({from: tag, to: 'HEAD'});
  return log.all;
}

function getCherryPickTargets(list) {
  const filteredCommits = [];

  return list.filter((logLine) => {
    // TODO: test perf and try using stream if it needs to be faster
    const parsedCommit = parser.sync(logLine.message, parserOpts);
    return parsedCommit.type !== 'feat' && !parsedCommit.notes.find((note) => title === 'BREAKING CHANGE');
  }).reverse();
}

async function test() {
  const tag = await getMostRecentTag();
  const list = await getCommitsAfterTag(tag);
  console.log(getCherryPickTargets(list).map((line) => line.hash).reverse());
}

test();
